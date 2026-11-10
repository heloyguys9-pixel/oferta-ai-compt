const PRODUCT_AMOUNT = 15.99;
const API_URL = "https://api.misticpay.com/api/transactions/create";
const {randomUUID} = require("node:crypto");

function send(res, status, body) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  return res.status(status).json(body);
}

function isValidCpf(value) {
  if (!/^\d{11}$/.test(value) || /^(\d)\1{10}$/.test(value)) return false;
  for (let position = 9; position < 11; position += 1) {
    let sum = 0;
    for (let index = 0; index < position; index += 1) {
      sum += Number(value[index]) * (position + 1 - index);
    }
    const digit = (sum * 10) % 11 % 10;
    if (digit !== Number(value[position])) return false;
  }
  return true;
}

function getCredentials() {
  const clientId = process.env.MISTICPAY_CLIENT_ID;
  const clientSecret = process.env.MISTICPAY_CLIENT_SECRET;
  if (!clientId || !clientSecret || !clientId.startsWith("pk_") || !clientSecret.startsWith("sk_")) return null;
  return `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`;
}

function isSameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    return new URL(origin).host === req.headers.host;
  } catch (error) {
    return false;
  }
}

module.exports = async function createPix(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return send(res, 405, {error:"Método não permitido."});
  }
  if (!isSameOrigin(req)) return send(res, 403, {error:"Origem da requisição não permitida."});

  const body = req.body && typeof req.body === "object" ? req.body : {};
  const payerName = typeof body.payerName === "string" ? body.payerName.trim() : "";
  const payerDocument = typeof body.payerDocument === "string" ? body.payerDocument.replace(/\D/g, "") : "";
  if (payerName.length < 2 || payerName.length > 100 || !isValidCpf(payerDocument)) {
    return send(res, 400, {error:"Informe um nome válido e um CPF válido."});
  }

  const authorization = getCredentials();
  if (!authorization) {
    console.error("MisticPay credentials are missing or do not use the current pk_/sk_ access-key format.");
    return send(res, 503, {error:"O Pix ainda não está configurado. Tente novamente mais tarde."});
  }

  const transactionId = randomUUID();
  let response;
  try {
    response = await fetch(API_URL, {
      method:"POST",
      headers:{"Authorization":authorization,"Content-Type":"application/json"},
      body:JSON.stringify({
        amount:PRODUCT_AMOUNT,
        payerName,
        payerDocument,
        transactionId,
        description:"Acesso ao método de atividades"
      }),
      signal:AbortSignal.timeout(15000)
    });
  } catch (error) {
    console.error("MisticPay charge request failed.", error);
    return send(res, 502, {error:"Não foi possível conectar à MisticPay. Tente novamente."});
  }

  let result;
  try {
    result = await response.json();
  } catch (error) {
    console.error("MisticPay returned an invalid charge response.", {status:response.status});
    return send(res, 502, {error:"A resposta do serviço Pix foi inválida. Tente novamente."});
  }

  if (!response.ok) {
    console.error("MisticPay rejected the charge request.", {
      status:response.status,
      code:result && typeof result.code === "string" ? result.code : "UNKNOWN",
      requestId:result && typeof result.requestId === "string" ? result.requestId : undefined
    });
    return send(res, 502, {
      error:"A MisticPay não conseguiu gerar a cobrança. Confira a configuração e tente novamente.",
      code:result && typeof result.code === "string" ? result.code : "UPSTREAM_ERROR"
    });
  }

  const transaction = result && result.data;
  if (!transaction || typeof transaction.qrCodeBase64 !== "string" ||
      !transaction.qrCodeBase64.startsWith("data:image/") ||
      typeof transaction.copyPaste !== "string" ||
      String(transaction.transactionId) !== transactionId) {
    console.error("MisticPay charge response did not contain the expected QR data.");
    return send(res, 502, {error:"A resposta do serviço Pix está incompleta. Tente novamente."});
  }

  return send(res, 200, {
    transactionId,
    qrCodeBase64:transaction.qrCodeBase64,
    copyPaste:transaction.copyPaste
  });
};
