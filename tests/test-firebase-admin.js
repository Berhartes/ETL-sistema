#!/usr/bin/env node
/**
 * Teste mínimo do Firebase Admin SDK
 */

import dotenv from 'dotenv';
dotenv.config();

import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { readFileSync } from 'fs';

console.log('🔧 Testando Firebase Admin SDK...');

try {
  // Configurar credenciais
  const serviceAccountPath = process.env.GOOGLE_APPLICATION_CREDENTIALS || './config/serviceAccountKey.json';
  const projectId = process.env.FIRESTORE_PROJECT_ID || process.env.GCP_PROJECT_ID;
  
  console.log(`   Project ID: ${projectId}`);
  console.log(`   Service Account: ${serviceAccountPath}`);

  // Carregar service account
  const serviceAccountKey = JSON.parse(readFileSync(serviceAccountPath, 'utf8'));
  console.log(`   ✅ Service Account: ${serviceAccountKey.client_email}`);

  // Inicializar Firebase Admin
  const app = initializeApp({
    credential: cert(serviceAccountKey),
    projectId: projectId
  });
  
  console.log('✅ Firebase Admin SDK inicializado');

  // Obter Firestore
  const db = getFirestore(app);
  console.log('✅ Firestore conectado');

  // Teste simples de escrita
  console.log('🔥 Testando escrita no Firestore...');
  
  const testDoc = db.collection('test').doc('connection_test');
  
  await testDoc.set({
    timestamp: FieldValue.serverTimestamp(),
    message: 'Firebase Admin SDK funcionando!',
    testId: Date.now()
  });
  
  console.log('✅ Documento de teste salvo com sucesso!');
  
  // Ler o documento de volta
  const snapshot = await testDoc.get();
  if (snapshot.exists) {
    console.log('✅ Documento lido:', snapshot.data());
  }
  
  // Limpar teste
  await testDoc.delete();
  console.log('✅ Documento de teste removido');
  
  console.log('🎉 Firebase Admin SDK está funcionando perfeitamente!');
  
} catch (error) {
  console.error('❌ Erro:', error.message);
  process.exit(1);
}