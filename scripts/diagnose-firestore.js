import dotenv from 'dotenv';
dotenv.config();
import { readFileSync } from 'fs';
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

(async function main(){
  try {
    const serviceAccountPath = process.env.GOOGLE_APPLICATION_CREDENTIALS || './config/serviceAccountKey.json';
    const serviceAccountKey = JSON.parse(readFileSync(serviceAccountPath, 'utf8'));

    const app = getApps().length ? getApps()[0] : initializeApp({ credential: cert(serviceAccountKey) });
    const db = getFirestore(app);

    console.log('Connected to project:', serviceAccountKey.project_id);

    // Log environment vars that can affect Firestore behavior
    const envKeys = [
      'GOOGLE_APPLICATION_CREDENTIALS',
      'FIRESTORE_EMULATOR_HOST',
      'FIRESTORE_PROJECT_ID',
      'FIRESTORE_DATASET',
      'FIRESTORE_EMULATOR',
      'VITE_FIREBASE_API_KEY',
      'VITE_FIREBASE_PROJECT_ID',
      'FIRESTORE_HOST'
    ];
    console.log('Relevant ENV:');
    for (const k of envKeys) {
      if (process.env[k]) console.log(`  ${k}=${process.env[k]}`);
    }

    console.log('Inspecting db object:');
    console.log('  type:', typeof db);
    try {
      console.log('  has collection method:', typeof db.collection === 'function');
      console.log('  keys:', Object.keys(db).slice(0,20));
    } catch (e) {
      console.warn('  could not inspect db object:', e.message);
    }

    const collections = ['deputados','despesas','etl_sessions','etl_stats'];
    for (const col of collections) {
      console.log(`\n--- Inspecting collection '${col}' ---`);
      try {
        const colRef = db.collection(col);
        console.log('  typeof colRef:', typeof colRef);
        console.log('  has get:', typeof colRef.get);
        console.log('  has listDocuments:', typeof colRef.listDocuments);
        try {
          console.log('  prototype methods:', Object.getOwnPropertyNames(Object.getPrototypeOf(colRef)).slice(0,50));
        } catch (pp) {
          console.warn('  could not list prototype methods:', pp.message);
        }

        // Try count() if available
        let count = 0;
        if (typeof colRef.count === 'function') {
          try {
            const agg = await colRef.count().get();
            count = agg.data().count;
          } catch (e) {
            console.warn('  count() failed:', e.message);
          }
        }

        // If count still zero, try listDocuments()
        if (!count && typeof colRef.listDocuments === 'function') {
          try {
            const docs = await colRef.listDocuments();
            count = docs.length;
          } catch (e) {
            console.warn('  listDocuments() failed:', e.message);
          }
        }

        console.log(`  Collection ${col}: approx ${count} documents`);
      } catch (err) {
        console.warn(`  Could not inspect collection ${col}: ${err.message}`);
      }
    }

    // Try a controlled write test using batch and then query it via REST
    try {
      console.log('\n--- Attempting a controlled test write to collection diag_test_write ---');
      const probeId = 'probe_manual';
      const batch = db.batch();
      const docRef = db.collection('diag_test_write').doc(probeId);
      batch.set(docRef, { probe: true, ts: Date.now() });
      await batch.commit();
      console.log('  Test write committed via batch.');

      // Build an OAuth2 access token using the service account (JWT flow)
      console.log('  Obtaining access token via JWT OAuth flow...');
      const serviceAccountPath = process.env.GOOGLE_APPLICATION_CREDENTIALS || './config/serviceAccountKey.json';
      const sa = JSON.parse(readFileSync(serviceAccountPath, 'utf8'));

      // Helper: base64url
      function base64url(input) {
        return Buffer.from(input).toString('base64')
          .replace(/=/g, '')
          .replace(/\+/g, '-')
          .replace(/\//g, '_');
      }

      const now = Math.floor(Date.now() / 1000);
      const header = { alg: 'RS256', typ: 'JWT' };
      const claim = {
        iss: sa.client_email,
        scope: 'https://www.googleapis.com/auth/datastore https://www.googleapis.com/auth/cloud-platform',
        aud: 'https://oauth2.googleapis.com/token',
        exp: now + 3600,
        iat: now
      };

      const unsignedJwt = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(claim))}`;

      const crypto = await import('crypto');
      const sign = crypto.sign('RSA-SHA256', Buffer.from(unsignedJwt), {
        key: sa.private_key,
        padding: crypto.constants.RSA_PKCS1_PADDING
      });
      const signature = base64url(sign);
      const jwt = `${unsignedJwt}.${signature}`;

      // Exchange JWT for access token
      const tokenResp = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: jwt })
      });

      if (!tokenResp.ok) {
        const txt = await tokenResp.text();
        throw new Error(`Token exchange failed: ${tokenResp.status} ${txt}`);
      }

      const tokenJson = await tokenResp.json();
      const accessToken = tokenJson.access_token;
      if (!accessToken) throw new Error('No access token received');

      console.log('  Access token obtained, querying Firestore REST for the probe document...');

      const project = sa.project_id;
      const docPath = `projects/${project}/databases/(default)/documents/diag_test_write/${probeId}`;
      const docUrl = `https://firestore.googleapis.com/v1/${docPath}`;

      const docResp = await fetch(docUrl, { headers: { Authorization: `Bearer ${accessToken}` } });
      if (docResp.ok) {
        const docJson = await docResp.json();
        console.log('  REST fetch successful. Document returned:');
        console.log(JSON.stringify(docJson, null, 2));
      } else {
        const body = await docResp.text();
        console.warn(`  REST fetch failed: ${docResp.status} - ${body}`);
      }

      // Also try listing the collection
      try {
        const listUrl = `https://firestore.googleapis.com/v1/projects/${sa.project_id}/databases/(default)/documents/diag_test_write?pageSize=20`;
        const listResp = await fetch(listUrl, { headers: { Authorization: `Bearer ${accessToken}` } });
        if (listResp.ok) {
          const listJson = await listResp.json();
          console.log('  Collection list response:');
          console.log(JSON.stringify(listJson, null, 2));
        } else {
          const lb = await listResp.text();
          console.warn(`  Collection list failed: ${listResp.status} - ${lb}`);
        }
      } catch (e) {
        console.warn('  Collection list error:', e.message);
      }

      // Try reading via modular SDK helpers (doc + getDoc)
      try {
        console.log('\n  Attempting SDK read using doc/getDoc...');
        const { doc, getDoc } = await import('firebase-admin/firestore');
        const docRef2 = doc(db, 'diag_test_write', probeId);
        const snap = await getDoc(docRef2);
        if (snap && snap.exists && typeof snap.exists === 'function' ? snap.exists() : snap.exists) {
          console.log('  SDK getDoc: document exists, data:');
          console.log(JSON.stringify(snap.data(), null, 2));
        } else {
          console.log('  SDK getDoc: document not found');
        }
      } catch (e) {
        console.warn('  SDK getDoc failed:', e.message);
      }

    } catch (writeErr) {
      console.warn('  Test write / REST probe failed:', writeErr.message);
    }

  // Close apps
  for (const a of getApps()) await a.delete();
    process.exit(0);
  } catch (error) {
    console.error('Diagnostic failed:', error.message);
    process.exit(1);
  }
})();
