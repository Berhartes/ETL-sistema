#!/usr/bin/env node
/**
 * 🔍 Teste de Conectividade Firestore
 * 
 * Script simples para diagnosticar problemas de conectividade
 */

import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { readFileSync } from 'fs';

async function testarConectividade() {
  console.log('🔍 Teste de Conectividade Firestore');
  console.log('═'.repeat(40));
  
  try {
    console.log('🔧 Carregando credenciais...');
    const serviceAccountPath = process.env.GOOGLE_APPLICATION_CREDENTIALS || './config/serviceAccountKey.json';
    const serviceAccountKey = JSON.parse(readFileSync(serviceAccountPath, 'utf8'));
    
    console.log(`✅ Service Account: ${serviceAccountKey.client_email}`);
    console.log(`✅ Project ID: ${serviceAccountKey.project_id}`);
    
    console.log('🔌 Inicializando Firebase Admin...');
    const app = getApps().length ? getApps()[0] : initializeApp({
      credential: cert(serviceAccountKey)
    });
    
    const db = getFirestore(app);
    
    console.log('🔄 Testando operação simples...');
    const startTime = Date.now();
    
    // Teste simples de escrita
    const testRef = db.collection('_connectivity_test').doc('ping');
    await testRef.set({
      timestamp: new Date(),
      test: 'connectivity'
    });
    
    const totalTime = Date.now() - startTime;
    console.log('');
    console.log('🎉 CONECTIVIDADE OK!');
    console.log('═'.repeat(40));
    console.log(`⏱️ Tempo: ${totalTime}ms`);
    
    // Limpar teste
    await testRef.delete();
    
  } catch (error) {
    console.log('');
    console.log('❌ FALHA NA CONECTIVIDADE');
    console.log('═'.repeat(40));
    console.log(`Erro: ${error.message}`);
    
    if (error.message.includes('DEADLINE_EXCEEDED')) {
      console.log('');
      console.log('🔍 Diagnóstico: TIMEOUT DE REDE');
      console.log('💡 Soluções:');
      console.log('   1. Testar com hotspot do celular');
      console.log('   2. Desabilitar firewall temporariamente');
      console.log('   3. Mudar DNS para 8.8.8.8');
      console.log('   4. Verificar antivírus');
    }
    
    process.exit(1);
  }
}

testarConectividade();