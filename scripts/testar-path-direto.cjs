#!/usr/bin/env node

const { initializeFirestore, getFirestoreDb } = require('./dist/utils/storage/firestore/config.js');

async function testarPathDireto() {
  console.log('🧪 TESTANDO PATHS DIRETOS NO FIRESTORE...\n');

  try {
    process.env.USE_REAL_FIRESTORE = 'true';
    process.env.USE_FIRESTORE_EMULATOR = 'false';
    
    await initializeFirestore();
    const db = getFirestoreDb();

    console.log('1. Testando path monitorgastos/fornecedores/lista/TESTE...');
    
    try {
      // Usar o mesmo método que o getDocRef usa
      const parts = 'monitorgastos/fornecedores/lista/TESTE'.split('/');
      console.log(`   📋 Segmentos: ${parts.length} - ${parts.join(' → ')}`);
      
      if (parts.length % 2 !== 0) {
        console.log('   ❌ ERRO: Número ímpar de segmentos');
        return;
      }
      
      // Reconstruir o path como o BatchManager faz
      let currentRef = db;
      for (let i = 0; i < parts.length; i += 2) {
        const collectionName = parts[i];
        const docId = parts[i + 1];
        
        if (i === 0) {
          currentRef = currentRef.collection(collectionName).doc(docId);
        } else {
          currentRef = currentRef.collection(collectionName).doc(docId);
        }
        
        console.log(`   📍 Etapa ${i/2 + 1}: collection(${collectionName}).doc(${docId})`);
      }
      
      console.log(`   🎯 Path final construído: ${currentRef.path}`);
      
      // Tentar salvar um documento de teste
      await currentRef.set({
        dados: {
          teste: true,
          timestamp: new Date(),
          pathOriginal: 'monitorgastos/fornecedores/lista/TESTE'
        }
      });
      
      console.log('   ✅ SUCESSO: Documento salvo');
      
      // Verificar se foi salvo
      const docSnap = await currentRef.get();
      if (docSnap.exists) {
        console.log('   ✅ CONFIRMADO: Documento existe no Firestore');
        console.log(`   📄 Dados: ${JSON.stringify(docSnap.data(), null, 2)}`);
      }
      
    } catch (error) {
      console.log(`   ❌ ERRO: ${error.message}`);
    }

    console.log('\n2. Verificando onde o documento foi realmente salvo...');
    
    try {
      // Verificar em monitorgastos/fornecedores/lista
      const listaRef = db.collection('monitorgastos/fornecedores/lista');
      const listaSnap = await listaRef.get();
      
      if (!listaSnap.empty) {
        console.log(`   ✅ Encontrado em monitorgastos/fornecedores/lista: ${listaSnap.size} documentos`);
        listaSnap.docs.forEach(doc => {
          console.log(`      📄 ${doc.id}`);
        });
      } else {
        console.log('   ❌ Nada em monitorgastos/fornecedores/lista');
      }
      
      // Verificar em monitorgastos/fornecedores (subcoleções)
      const fornecedoresRef = db.doc('monitorgastos/fornecedores');
      const subcols = await fornecedoresRef.listCollections();
      
      if (subcols.length > 0) {
        console.log(`   ✅ Subcoleções em monitorgastos/fornecedores: ${subcols.slice(0, 5).map(s => s.id).join(', ')}`);
      }
      
    } catch (error) {
      console.log(`   ❌ ERRO na verificação: ${error.message}`);
    }

  } catch (error) {
    console.error('❌ Erro geral:', error.message);
  }
}

testarPathDireto().then(() => process.exit(0));
