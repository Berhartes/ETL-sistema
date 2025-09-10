import { readFileSync } from 'fs';

async function main(){
  try {
    const saPath = process.env.GOOGLE_APPLICATION_CREDENTIALS || './config/serviceAccountKey.json';
    const sa = JSON.parse(readFileSync(saPath,'utf8'));
    const project = sa.project_id;

    // helper base64url
    const base64url = s => Buffer.from(s).toString('base64').replace(/=+$/,'').replace(/\+/g,'-').replace(/\//g,'_');
    const now = Math.floor(Date.now()/1000);
    const header = { alg: 'RS256', typ: 'JWT' };
    const claim = {
      iss: sa.client_email,
      scope: 'https://www.googleapis.com/auth/datastore https://www.googleapis.com/auth/cloud-platform',
      aud: 'https://oauth2.googleapis.com/token',
      exp: now + 3600,
      iat: now
    };

    const unsigned = base64url(JSON.stringify(header))+'.'+base64url(JSON.stringify(claim));
    const crypto = await import('crypto');
    const sign = crypto.sign('RSA-SHA256', Buffer.from(unsigned), { key: sa.private_key, padding: crypto.constants.RSA_PKCS1_PADDING });
    const jwt = unsigned + '.' + base64url(sign);

    const tokenResp = await fetch('https://oauth2.googleapis.com/token',{
      method:'POST',
      headers:{'Content-Type':'application/x-www-form-urlencoded'},
      body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: jwt })
    });

    if(!tokenResp.ok){
      const body = await tokenResp.text();
      throw new Error('Token exchange failed: '+ tokenResp.status + ' ' + body);
    }

    const tokenJson = await tokenResp.json();
    const accessToken = tokenJson.access_token;
    console.log('Access token obtained (len):', accessToken ? accessToken.length : 0);

    // Write a document via REST
    const collection = 'diag_rest';
    const docId = 'probe_rest_'+Date.now();
    const writeUrl = `https://firestore.googleapis.com/v1/projects/${project}/databases/(default)/documents/${collection}?documentId=${docId}`;

    const body = {
      fields: {
        probe: { booleanValue: true },
        ts: { integerValue: `${Date.now()}` },
        message: { stringValue: 'rest_probe' }
      }
    };

    const wr = await fetch(writeUrl, { method: 'POST', headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const wrText = await wr.text();
    console.log('Write status:', wr.status);
    console.log('Write body:', wrText);

    // Try to read it back
    const getUrl = `https://firestore.googleapis.com/v1/projects/${project}/databases/(default)/documents/${collection}/${docId}`;
    const gr = await fetch(getUrl, { headers: { Authorization: `Bearer ${accessToken}` } });
    console.log('GET status:', gr.status);
    console.log('GET body:', await gr.text());

  } catch (err) {
    console.error('Probe failed:', err.message);
    process.exit(1);
  }
}

main();
