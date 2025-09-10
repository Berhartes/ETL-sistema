#!/usr/bin/env node

const { initializeFirestore, getFirestoreDb } = require('./dist/utils/storage/firestore/config.js');

async function verificarColecoesBasicas() {
  console.log('🔍 VERIFICANDO COLEÇÕES BÁSICAS NO FIRESTORE...\n');

  try {
    process.env.USE_REAL_FIRESTORE = 'true';
    process.env.USE_FIRESTORE_EMULATOR = 'false';
    
    await initializeFirestore();
    const db = getFirestoreDb();

    console.log('1. Verificando coleção raiz "monitorgastos"...');
    try {
      const monitorRef = db.collection('monitorgastos');
      const monitorSnap = await monitorRef.get();
      
      if (!monitorSnap.empty) {
        console.log(`✅ Coleção monitorgastos existe com ${monitorSnap.size} documentos`);
        
        for (const doc of monitorSnap.docs) {
          console.log(`   📄 Documento: ${doc.id}`);
        }
      } else {
        console.log('❌ Coleção monitorgastos está vazia');
      }
    } catch (e) {
      console.log(`⚠️ Erro: ${e.message}`);
    }

    console.log('\n2. Verificando subcoleções de monitorgastos...');
    try {
      // Verificar se monitorgastos tem subcoleções
      const docRef = db.doc('monitorgastos/despesas');
      const docSnap = await docRef.get();
      
      if (docSnap.exists) {
        console.log('✅ Documento monitorgastos/despesas existe');
        const subcols = await docRef.listCollections();
        console.log(`   📁 Subcoleções: ${subcols.map(s => s.id).join(', ')}`);
      } else {
        console.log('❌ Documento monitorgastos/despesas não existe');
      }
    } catch (e) {
      console.log(`⚠️ Erro ao verificar subcoleções: ${e.message}`);
    }

    console.log('\n3. Verificando monitorgastos/despesas/lista diretamente...');
    try {
      const listaRef = db.collection('monitorgastos/despesas/lista');
      const listaSnap = await listaRef.get();
      
      if (!listaSnap.empty) {
        console.log(`✅ Coleção monitorgastos/despesas/lista existe com ${listaSnap.size} documentos`);
        
        for (const doc of listaSnap.docs) {
          console.log(`   📄 Deputado: ${doc.id}`);
        }
      } else {
        console.log('❌ Coleção monitorgastos/despesas/lista está vazia');
      }
    } catch (e) {
      console.log(`⚠️ Erro: ${e.message}`);
    }

    console.log('\n4. Verificando monitorgastos/fornecedores/lista diretamente...');
    try {
      const listaRef = db.collection('monitorgastos/fornecedores/lista');
      const listaSnap = await listaRef.get();
      
      if (!listaSnap.empty) {
        console.log(`✅ Coleção monitorgastos/fornecedores/lista existe com ${listaSnap.size} documentos`);
        
        for (const doc of listaSnap.docs.slice(0, 5)) {
          console.log(`   📄 Fornecedor: ${doc.id}`);
        }
      } else {
        console.log('❌ Coleção monitorgastos/fornecedores/lista está vazia');
      }
    } catch (e) {
      console.log(`⚠️ Erro: ${e.message}`);
    }

  } catch (error) {
    console.error('❌ Erro geral:', error.message);
  }
}

verificarColecoesBasicas().then(() => process.exit(0));
