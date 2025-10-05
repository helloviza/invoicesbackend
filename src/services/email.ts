import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';

const ses = new SESClient({ region: process.env.AWS_REGION });

export async function sendInvoiceEmail(opts: { to: string[]; subject: string; html: string; }) {
  if (process.env.DISABLE_EMAIL === 'true') {
    console.log('🟡 [LOCAL EMAIL MOCK] Would send:', { ...opts, from: process.env.SES_SENDER });
    return;
  }
  const From = process.env.SES_SENDER!;
  const cmd = new SendEmailCommand({
    Destination: { ToAddresses: opts.to },
    Message: { Body: { Html: { Charset: 'UTF-8', Data: opts.html } }, Subject: { Charset: 'UTF-8', Data: opts.subject } },
    Source: From,
  });
  await ses.send(cmd);
}
