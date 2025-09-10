#!/usr/bin/env node

const { initializeFirestore, getFirestoreDb } = require('./dist/utils/storage/firestore/config.js');

async function verificarFornecedorEspecifico() {
  console.log('🔍 Verificando fornecedor específico...\n');

  try {
    process.env.USE_REAL_FIRESTORE = 'true';
    process.env.USE_FIRESTORE_EMULATOR = 'false';
    
    await initializeFirestore();
    const db = getFirestoreDb();

    const cnpj = '00469171000164'; // CNPJ que apareceu nos logs

    console.log(`🏢 Verificando fornecedor CNPJ: ${cnpj}...`);
    
    // Verificar dados básicos
    const fornecedorDadosRef = db.doc(`monitorgastos/fornecedores/${cnpj}/dados`);
    const fornecedorDadosSnap = await fornecedorDadosRef.get();
    
    if (fornecedorDadosSnap.exists) {
      const data = fornecedorDadosSnap.data();
      console.log(`   ✅ Dados básicos:`);
      console.log(`      📛 Nome: ${data.nome || 'N/A'}`);
      console.log(`      🏢 Razão Social: ${data.razaoSocial || 'N/A'}`);
      console.log(`      💰 Total recebido: R$ ${(data.totalRecebido || 0).toLocaleString('pt-BR')}`);
      console.log(`      📊 Transações: ${data.numeroTransacoes || 0}`);
      console.log(`      👥 Deputados: ${data.numeroDeputados || 0}`);
      console.log(`      ✅ Ativo: ${data.ativo}`);
      console.log(`      📅 Criado: ${data.criadoEm?.toDate?.() || data.criadoEm}`);
    } else {
      console.log('   ❌ Dados básicos não encontrados');
    }

    // Verificar dados consolidados
    const fornecedorConsolidadoRef = db.doc(`monitorgastos/fornecedores/${cnpj}/consolidado`);
    const fornecedorConsolidadoSnap = await fornecedorConsolidadoRef.get();
    
    if (fornecedorConsolidadoSnap.exists) {
      const data = fornecedorConsolidadoSnap.data();
      console.log(`\n   💼 Dados consolidados:`);
      console.log(`      💰 Valor total geral: R$ ${(data.valorTotalGeral || 0).toLocaleString('pt-BR')}`);
      console.log(`      📊 Total transações: ${data.totalTransacoes || 0}`);
      console.log(`      📅 Anos ativos: ${(data.anosAtivos || []).join(', ')}`);
      console.log(`      👥 Deputados únicos: ${data.numeroDeputadosUnicos || 0}`);
    } else {
      console.log('   ❌ Dados consolidados não encontrados');
    }

    // Verificar transações por ano
    console.log(`\n🔄 Verificando transações do fornecedor...`);
    const fornecedorTransacoesRef = db.collection(`monitorgastos/fornecedores_transacoes/${cnpj}`);
    const fornecedorTransacoesSnap = await fornecedorTransacoesRef.get();
    
    console.log(`   📅 Anos com transações: ${fornecedorTransacoesSnap.size}`);
    
    if (!fornecedorTransacoesSnap.empty) {
      fornecedorTransacoesSnap.docs.forEach(doc => {
        const data = doc.data();
        console.log(`      📅 Ano ${doc.id}:`);
        console.log(`         💰 Valor: R$ ${(data.valorTotal || 0).toLocaleString('pt-BR')}`);
        console.log(`         📊 Transações: ${data.totalTransacoes || 0}`);
        console.log(`         🏢 Deputados: ${(data.deputadosAtendidos || []).length}`);
        console.log(`         📅 Meses ativos: ${data.mesesAtivos || 0}`);
      });
    }

    console.log('\n✅ ESTRUTURA DE FORNECEDORES VERIFICADA COM SUCESSO!');

  } catch (error) {
    console.error('❌ Erro na verificação:', error.message);
  }
}

verificarFornecedorEspecifico().then(() => {
  process.exit(0);
}).catch(error => {
  console.error('💥 Erro fatal:', error.message);
  process.exit(1);
});