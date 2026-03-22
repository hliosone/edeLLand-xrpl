// TODO: récupérer les vrais txs XRPL + générer le XML via lib/flowpay/merchant.js
export async function GET(request, { params }) {
  const address = params?.address ?? "rUNKNOWN";
  const now = new Date().toISOString();

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.053.001.02">
  <BkToCstmrStmt>
    <GrpHdr>
      <MsgId>FLOWPAY-${Date.now()}</MsgId>
      <CreDtTm>${now}</CreDtTm>
    </GrpHdr>
    <Stmt>
      <Id>STMT-${address.slice(0,8)}</Id>
      <Acct>
        <Id><Othr><Id>${address}</Id></Othr></Id>
        <Ccy>RLU</Ccy>
      </Acct>
      <Ntry>
        <Amt Ccy="RLU">1500</Amt>
        <CdtDbtInd>CRDT</CdtDbtInd>
        <BookgDt><Dt>2024-03-14</Dt></BookgDt>
        <NtryDtls>
          <TxDtls>
            <RmtInf><Ustrd>FlowPay BNPL Payment - MacBook Pro M4</Ustrd></RmtInf>
          </TxDtls>
        </NtryDtls>
      </Ntry>
    </Stmt>
  </BkToCstmrStmt>
</Document>`;

  return new Response(xml, {
    headers: {
      "Content-Type": "application/xml",
      "Content-Disposition": `attachment; filename="camt053_${address.slice(0,8)}.xml"`,
    },
  });
}
