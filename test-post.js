const body = {
  clientId: "68c19fa4210bec7717532f60",
  serviceType: "HOTELS",
  issueDate: "2025-09-10",
  currency: "INR",
  items: [{
    sNo: 1,
    details: {
      roomType: "Deluxe",
      paxName: "John Doe",
      rooms: 2,
      nights: 3,
      rate: 4500,
      tax: 810,
      serviceCharges: 200,
      currency: "INR"
    }
  }],
  notes: "Local demo invoice"
};

(async () => {
  const r = await fetch("http://localhost:8080/api/invoices", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await r.text();
  console.log("status:", r.status);
  console.log(text);
})();
