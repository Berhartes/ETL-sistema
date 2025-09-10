#!/usr/bin/env node

const { initializeFirestore, getFirestoreDb } = require('./dist/utils/storage/firestore/config.js');

async function verificarEstrutura() {
  console.log('🔍 VERIFICANDO ONDE OS DADOS FORAM REALMENTE SALVOS...\n');

  try {
    process.env.USE_REAL_FIRESTORE = 'true';
    process.env.USE_FIRESTORE_EMULATOR = 'false';
    
    await initializeFirestore();
    const db = getFirestoreDb();

    // Verificar deputado na nova estrutura proposta
    console.log('🔍 1. Verificando monitorgastos/despesas...');
    try {
      const despesasRef = db.collection('monitorgastos/despesas/lista');
      const despesasSnap = await despesasRef.limit(3).get();
      
      if (!despesasSnap.empty) {
        console.log(`✅ Encontrados ${despesasSnap.size} deputados em monitorgastos/despesas/lista`);
        
        for (const doc of despesasSnap.docs) {
          console.log(`   👤 Deputado ID: ${doc.id}`);
          
          // Verificar o documento dados
          const dadosRef = db.doc(`monitorgastos/despesas/lista/${doc.id}/dados`);
          const dadosSnap = await dadosRef.get();
          
          if (dadosSnap.exists()) {
            const data = dadosSnap.data();
            console.log(`      ✅ Dados encontrados: ${data.nome} (${data.totalDespesas || 0} despesas)`);
          }
        }
      } else {
        console.log('❌ Nenhum deputado encontrado em monitorgastos/despesas/lista');
      }
    } catch (e) {
      console.log(`⚠️ Erro: ${e.message}`);
    }

    // Verificar fornecedores na nova estrutura proposta
    console.log('\n🔍 2. Verificando monitorgastos/fornecedores...');
    try {
      const fornecedoresRef = db.collection('monitorgastos/fornecedores/lista');
      const fornecedoresSnap = await fornecedoresRef.limit(3).get();
      
      if (!fornecedoresSnap.empty) {
        console.log(`✅ Encontrados ${fornecedoresSnap.size} fornecedores em monitorgastos/fornecedores/lista`);
        
        for (const doc of fornecedoresSnap.docs) {
          console.log(`   🏢 Fornecedor ID: ${doc.id}`);
          
          // Verificar o documento dados
          const dadosRef = db.doc(`monitorgastos/fornecedores/lista/${doc.id}/dados`);
          const dadosSnap = await dadosRef.get();
          
          if (dadosSnap.exists()) {
            const data = dadosSnap.data();
            console.log(`      ✅ Dados encontrados: ${data.nome} (R$ ${(data.totalRecebido || 0).toLocaleString('pt-BR')})`);
          }
        }
      } else {
        console.log('❌ Nenhum fornecedor encontrado em monitorgastos/fornecedores/lista');
      }
    } catch (e) {
      console.log(`⚠️ Erro: ${e.message}`);
    }

    // Verificar onde os dados foram REALMENTE salvos
    console.log('\n🔍 3. Verificando estrutura real criada pelo ETL...');
    try {
      const monitorRef = db.collection('monitorgastos');
      const monitorSnap = await monitorRef.get();
      
      if (!monitorSnap.empty) {
        console.log('✅ Coleção monitorgastos existe');
        for (const doc of monitorSnap.docs) {
          console.log(`   📂 Documento: ${doc.id}`);
        }
      }
    } catch (e) {
      console.log(`⚠️ Erro: ${e.message}`);
    }

  } catch (error) {
    console.error('❌ Erro:', error.message);
  }
}

verificarEstrutura().then(() => process.exit(0));
