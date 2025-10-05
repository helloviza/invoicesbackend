// apps/backend/scripts/set-admin-password.mjs
// @ts-nocheck
import bcrypt from "bcryptjs";

const [, , EMAIL, NEWPASS, ...rest] = process.argv;
const ROLE =
  rest.find(a => a.toLowerCase() === "--viewer") ? "VIEWER" :
  rest.find(a => a.toLowerCase() === "--editor") ? "EDITOR" :
  rest.find(a => a.toLowerCase() === "--admin")  ? "ADMIN"  : "ADMIN";

// Password policy: 6–18 chars, 1 upper, 1 lower, 1 digit, 1 special
const POLICY = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{6,18}$/;

if (!EMAIL || !NEWPASS) {
  console.error("Usage: node scripts/set-admin-password.mjs <email> <newPassword> [--admin|--editor|--viewer]");
  process.exit(1);
}
if (!POLICY.test(NEWPASS)) {
  console.error("Password does not meet policy: 6–18 chars, at least 1 upper, 1 lower, 1 digit, 1 special.");
  process.exit(1);
}

const HASH = bcrypt.hashSync(NEWPASS, 10);
const now = new Date();

async function tryPrisma() {
  try {
    const { PrismaClient } = await import("@prisma/client");
    const prisma = new PrismaClient();

    const candidates = ["user", "users", "authUser", "appUser", "account"];
    const key = candidates.find(k => typeof prisma[k]?.updateMany === "function");

    if (!key) {
      await prisma.$disconnect();
      console.warn("[Prisma] No compatible user model found (tried:", candidates.join(", "), ").");
      return false;
    }

    const data = { passwordHash: HASH, role: ROLE, updatedAt: now };
    const upd = await prisma[key].updateMany({ where: { email: EMAIL }, data });

    if (upd.count > 0) {
      console.log(`[Prisma] Updated ${upd.count} user(s) for ${EMAIL} on model '${key}'.`);
      await prisma.$disconnect();
      return true;
    }

    if (typeof prisma[key]?.create === "function") {
      const username = EMAIL.split("@")[0];
      try {
        await prisma[key].create({
          data: {
            email: EMAIL,
            username,
            name: "Admin",
            role: ROLE,
            passwordHash: HASH,
            createdAt: now,
            updatedAt: now,
          },
        });
        console.log(`[Prisma] Created user ${EMAIL} with role ${ROLE} on model '${key}'.`);
        await prisma.$disconnect();
        return true;
      } catch (e) {
        console.warn(`[Prisma] create failed: ${e?.message || e}`);
      }
    }

    await prisma.$disconnect();
    return false;
  } catch (e) {
    console.warn(`[Prisma] Skipping Prisma path: ${e?.message || e}`);
    return false;
  }
}

async function tryMongo() {
  try {
    const uri =
      process.env.DATABASE_URL ||
      process.env.MONGODB_URI ||
      process.env.MONGO_URI;

    if (!uri || !uri.startsWith("mongodb")) {
      console.error("No Mongo URI found in env (DATABASE_URL / MONGODB_URI / MONGO_URI).");
      return false;
    }

    const { MongoClient } = await import("mongodb");
    const client = new MongoClient(uri);
    await client.connect();
    const db = client.db();

    const cols = await db.listCollections().toArray();
    let collName =
      cols.map(c => c.name).find(n => /^users?$/i.test(n)) ||
      cols.map(c => c.name).find(n => /user/i.test(n)) ||
      "users";

    if (!cols.some(c => c.name === collName)) {
      try { await db.createCollection(collName); } catch {}
    }

    const col = db.collection(collName);
    const username = EMAIL.split("@")[0];
    const res = await col.updateOne(
      { email: EMAIL },
      {
        $set: {
          email: EMAIL,
          username,
          name: "Admin",
          role: ROLE,
          passwordHash: HASH,
          updatedAt: now,
        },
        $setOnInsert: { createdAt: now },
      },
      { upsert: true }
    );

    if (res.upsertedCount) {
      console.log(`[Mongo] Created user ${EMAIL} with role ${ROLE} in '${collName}'.`);
    } else if (res.matchedCount) {
      console.log(`[Mongo] Updated user ${EMAIL} in '${collName}'.`);
    } else {
      console.log(`[Mongo] No change for ${EMAIL} in '${collName}'.`);
    }

    await client.close();
    return true;
  } catch (e) {
    console.error(`[Mongo] Failed: ${e?.message || e}`);
    return false;
  }
}

(async () => {
  const okPrisma = await tryPrisma();
  if (okPrisma) process.exit(0);

  const okMongo = await tryMongo();
  if (okMongo) process.exit(0);

  console.error("No suitable backend (Prisma or MongoDB) worked. Aborting.");
  process.exit(2);
})();
