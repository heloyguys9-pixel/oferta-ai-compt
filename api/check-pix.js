const API_URL = "https://api.misticpay.com/api/transactions/check";

function send(res, status, body) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  return res.status(status).json(body);
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

module.exports = async function checkPix(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return send(res, 405, {error:"Método não permitido."});
  }
  if (!isSameOrigin(req)) return send(res, 403, {error:"Origem da requisição não permitida."});

  const transactionId = req.body && typeof req.body.transactionId === "string"
    ? req.body.transactionId
    : "";
  if (!/^[\da-f-]{36}$/i.test(transactionId)) {
    return send(res, 400, {error:"Identificador de transação inválido."});
  }

  const authorization = getCredentials();
  if (!authorization) {
    console.error("MisticPay credentials are missing or do not use the current pk_/sk_ access-key format.");
    return send(res, 503, {error:"A consulta de Pix ainda não está configurada."});
  }

  let response;
  try {
    response = await fetch(API_URL, {
      method:"POST",
      headers:{"Authorization":authorization,"Content-Type":"application/json"},
      body:JSON.stringify({transactionId}),
      signal:AbortSignal.timeout(15000)
    });
  } catch (error) {
    console.error("MisticPay transaction check failed.", error);
    return send(res, 502, {error:"Não foi possível consultar o pagamento. Tente novamente."});
  }

  let result;
  try {
    result = await response.json();
  } catch (error) {
    console.error("MisticPay returned an invalid transaction status response.", {status:response.status});
    return send(res, 502, {error:"A resposta da consulta Pix foi inválida."});
  }

  if (!response.ok || !result || !result.transaction || typeof result.transaction.transactionState !== "string") {
    console.error("MisticPay could not confirm the transaction status.", {
      status:response.status,
      code:result && typeof result.code === "string" ? result.code : "UNKNOWN",
      requestId:result && typeof result.requestId === "string" ? result.requestId : undefined
    });
    return send(res, 502, {error:"Não foi possível confirmar o pagamento. Tente novamente."});
  }

  return send(res, 200, {status:result.transaction.transactionState});
};
