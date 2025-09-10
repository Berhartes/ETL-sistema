#!/usr/bin/env node

/**
 * Verificação específica da nova estrutura corrigida
 */

const { initializeFirestore, getFirestoreDb } = require('./dist/utils/storage/firestore/config.js');

async function verificarNovaEstrutura() {
  console.log('🔍 VERIFICANDO NOVA ESTRUTURA CORRIGIDA...\n');

  try {
    process.env.USE_REAL_FIRESTORE = 'true';
    process.env.USE_FIRESTORE_EMULATOR = 'false';
    
    await initializeFirestore();
    const db = getFirestoreDb();

    console.log('👥 1. VERIFICANDO DEPUTADO 220593...');
    
    // Verificar estrutura corrigida: monitorgastos/despesas/lista/{deputadoId}/dados
    try {
      const deputadoRef = db.doc('monitorgastos/despesas/lista/220593/dados');
      const deputadoSnap = await deputadoRef.get();
      
      if (deputadoSnap.exists()) {
        const data = deputadoSnap.data();
        console.log('✅ DEPUTADO ENCONTRADO na estrutura corrigida!');
        console.log(`   📛 Nome: ${data.nome}`);
        console.log(`   🏛️ Partido: ${data.siglaPartido}`);
        console.log(`   📍 UF: ${data.siglaUf}`);
        console.log(`   💰 Total gastos: R$ ${(data.valorTotalGeral || 0).toLocaleString('pt-BR')}`);
        console.log(`   📊 Total despesas: ${data.totalDespesas || 0}`);
        
        if (data.despesas && Array.isArray(data.despesas)) {
          console.log(`   🎯 Array de despesas: ${data.despesas.length} transações`);
          
          // Mostrar exemplo de despesa
          if (data.despesas[0]) {
            const exemploDesp = data.despesas[0];
            console.log(`   💰 Exemplo despesa: R$ ${exemploDesp.valorLiquido} - ${exemploDesp.fornecedor}`);
          }
        }
        
        console.log(`   📋 Todos os campos: ${Object.keys(data).join(', ')}`);
      } else {
        console.log('❌ DEPUTADO NÃO ENCONTRADO na estrutura corrigida');
      }
    } catch (deputadoError) {
      console.log(`⚠️ Erro ao verificar deputado: ${deputadoError.message}`);
    }

    console.log('\n🏢 2. VERIFICANDO FORNECEDORES...');
    
    // Verificar alguns fornecedores
    const fornecedoresParaVerificar = ['00469171000164', '37841433000180'];
    
    for (const cnpj of fornecedoresParaVerificar) {
      try {
        console.log(`\n   🔍 Verificando fornecedor ${cnpj}...`);
        
        // Estrutura atual (incorreta): monitorgastos/fornecedores/{cnpj}
        const fornecedorAtualRef = db.doc(`monitorgastos/fornecedores/${cnpj}`);
        const fornecedorAtualSnap = await fornecedorAtualRef.get();
        
        if (fornecedorAtualSnap.exists()) {
          console.log(`   ❌ ENCONTRADO na estrutura INCORRETA: monitorgastos/fornecedores/${cnpj}`);
          const data = fornecedorAtualSnap.data();
          console.log(`      📛 Nome: ${data.nome || data.identificacao?.nome}`);
          console.log(`      💰 Total: R$ ${(data.totalRecebido || 0).toLocaleString('pt-BR')}`);
        }
        
        // Estrutura corrigida: monitorgastos/fornecedores/lista/{cnpj}/dados
        const fornecedorCorrigidoRef = db.doc(`monitorgastos/fornecedores/lista/${cnpj}/dados`);
        const fornecedorCorrigidoSnap = await fornecedorCorrigidoRef.get();
        
        if (fornecedorCorrigidoSnap.exists()) {
          console.log(`   ✅ ENCONTRADO na estrutura CORRIGIDA: monitorgastos/fornecedores/lista/${cnpj}/dados`);
          const data = fornecedorCorrigidoSnap.data();
          console.log(`      📛 Nome: ${data.nome}`);
          console.log(`      💰 Total: R$ ${(data.totalRecebido || 0).toLocaleString('pt-BR')}`);
          console.log(`      📊 Transações: ${(data.transacoes || []).length}`);
        } else {
          console.log(`   ❌ NÃO ENCONTRADO na estrutura CORRIGIDA: monitorgastos/fornecedores/lista/${cnpj}/dados`);
        }
        
      } catch (fornecedorError) {
        console.log(`   ⚠️ Erro ao verificar fornecedor ${cnpj}: ${fornecedorError.message}`);
      }
    }

    console.log('\n🎉 VERIFICAÇÃO CONCLUÍDA!');

  } catch (error) {
    console.error('❌ Erro na verificação:', error.message);
  }
}

verificarNovaEstrutura().then(() => {
  process.exit(0);
}).catch(error => {
  console.error('💥 Erro fatal:', error.message);
  process.exit(1);
});
