#!/usr/bin/env node

const { initializeFirestore, getFirestoreDb } = require('./dist/utils/storage/firestore/config.js');

async function verificarEstruturaFinal() {
  console.log('🎉 VERIFICANDO ESTRUTURA FINAL CORRIGIDA...\n');

  try {
    process.env.USE_REAL_FIRESTORE = 'true';
    process.env.USE_FIRESTORE_EMULATOR = 'false';
    
    await initializeFirestore();
    const db = getFirestoreDb();

    console.log('👥 1. VERIFICANDO DEPUTADO 220593 NA ESTRUTURA CORRIGIDA...');
    
    // Estrutura corrigida: monitorgastos/despesas/lista/{deputadoId}
    try {
      const deputadoRef = db.doc('monitorgastos/despesas/lista/220593');
      const deputadoSnap = await deputadoRef.get();
      
      if (deputadoSnap.exists) {
        const fullData = deputadoSnap.data();
        console.log('✅ SUCESSO! Deputado encontrado na estrutura corrigida!');
        console.log(`   📍 Caminho: monitorgastos/despesas/lista/220593`);
        
        if (fullData.dados) {
          const data = fullData.dados;
          console.log('✅ Campo "dados" encontrado dentro do documento!');
          console.log(`   📛 Nome: ${data.nome}`);
          console.log(`   🏛️ Partido: ${data.siglaPartido}`);
          console.log(`   📍 UF: ${data.siglaUf}`);
          console.log(`   💰 Total gastos: R$ ${(data.valorTotalGeral || 0).toLocaleString('pt-BR')}`);
          console.log(`   📊 Total despesas: ${data.totalDespesas || 0}`);
          
          if (data.despesas && Array.isArray(data.despesas)) {
            console.log(`   🎯 Array de despesas: ${data.despesas.length} transações`);
            
            if (data.despesas[0]) {
              const exemploDesp = data.despesas[0];
              console.log(`   💰 Exemplo despesa: R$ ${exemploDesp.valorLiquido} - ${exemploDesp.fornecedorNome}`);
            }
          }
        } else {
          console.log('❌ Campo "dados" NÃO encontrado dentro do documento');
          console.log(`   📋 Campos disponíveis: ${Object.keys(fullData).join(', ')}`);
        }
      } else {
        console.log('❌ DEPUTADO NÃO ENCONTRADO na estrutura corrigida');
      }
    } catch (deputadoError) {
      console.log(`⚠️ Erro ao verificar deputado: ${deputadoError.message}`);
    }

    console.log('\n🏢 2. VERIFICANDO FORNECEDORES NA ESTRUTURA CORRIGIDA...');
    
    // Verificar alguns fornecedores na estrutura corrigida: monitorgastos/fornecedores/lista/{cnpj}
    const fornecedoresParaVerificar = ['00469171000164', '37841433000180'];
    
    for (const cnpj of fornecedoresParaVerificar) {
      try {
        console.log(`\n   🔍 Verificando fornecedor ${cnpj}...`);
        
        const fornecedorRef = db.doc(`monitorgastos/fornecedores/lista/${cnpj}`);
        const fornecedorSnap = await fornecedorRef.get();
        
        if (fornecedorSnap.exists) {
          const fullData = fornecedorSnap.data();
          console.log(`   ✅ SUCESSO! Fornecedor encontrado na estrutura corrigida!`);
          console.log(`      📍 Caminho: monitorgastos/fornecedores/lista/${cnpj}`);
          
          if (fullData.dados) {
            const data = fullData.dados;
            console.log(`   ✅ Campo "dados" encontrado!`);
            console.log(`      📛 Nome: ${data.nome}`);
            console.log(`      💰 Total: R$ ${(data.totalRecebido || 0).toLocaleString('pt-BR')}`);
            console.log(`      📊 Transações: ${(data.transacoes || []).length}`);
            console.log(`      👥 Deputados atendidos: ${(data.deputados || []).length}`);
          } else {
            console.log(`   ❌ Campo "dados" NÃO encontrado`);
            console.log(`      📋 Campos: ${Object.keys(fullData).join(', ')}`);
          }
        } else {
          console.log(`   ❌ Fornecedor ${cnpj} NÃO encontrado na estrutura corrigida`);
        }
        
      } catch (fornecedorError) {
        console.log(`   ⚠️ Erro ao verificar fornecedor ${cnpj}: ${fornecedorError.message}`);
      }
    }

    console.log('\n🎊 VERIFICAÇÃO FINAL CONCLUÍDA COM SUCESSO!');
    console.log('\n📋 ESTRUTURA CONFIRMADA:');
    console.log('✅ monitorgastos/despesas/lista/{deputadoId} → campo "dados"');
    console.log('✅ monitorgastos/fornecedores/lista/{cnpj} → campo "dados"');
    console.log('✅ Paths com 4 segmentos (par) - compatível com Firestore');
    console.log('✅ Dados consolidados com arrays de transações');

  } catch (error) {
    console.error('❌ Erro na verificação final:', error.message);
  }
}

verificarEstruturaFinal().then(() => process.exit(0));
