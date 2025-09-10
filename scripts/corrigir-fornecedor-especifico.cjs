/**
 * Script para corrigir fornecedor específico
 * - Corrige nomenclatura de campos
 * - Adiciona categoriaPrincipal baseada no tipo (HOTEL -> HOSPEDAGEM)
 */

const admin = require('firebase-admin');
const serviceAccount = require('./config/serviceAccountKey.json');

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    projectId: serviceAccount.project_id
  });
}

const db = admin.firestore();

async function corrigirFornecedorEspecifico() {
  const cnpj = '00082535000159'; // HOTEL GIRASSOL PLAZA
  console.log(`🔍 Corrigindo fornecedor específico: ${cnpj}`);
  
  try {
    const fornecedorRef = db.collection('monitorgastos/fornecedores/lista').doc(cnpj);
    const fornecedorDoc = await fornecedorRef.get();
    
    if (!fornecedorDoc.exists) {
      console.log('❌ Fornecedor não encontrado');
      return;
    }
    
    const fornecedorData = fornecedorDoc.data();
    console.log('📋 Dados atuais:');
    console.log(JSON.stringify(fornecedorData, null, 2));
    
    // Os dados estão no subcampo "dados"
    const dadosAtuais = fornecedorData.dados || {};
    
    // Preparar dados corrigidos
    const dadosCorrigidos = {
      ...dadosAtuais,
      
      // Garantir nomenclatura correta
      nome: dadosAtuais.nomeFornecedor || dadosAtuais.nome || 'HOTEL GIRASSOL PLAZA',
      cnpjCpf: dadosAtuais.cnpjCpfFornecedor || dadosAtuais.cnpjCpf || dadosAtuais.id || cnpj,
      
      // Adicionar categoria principal baseada no nome (HOTEL -> HOSPEDAGEM)
      categoriaPrincipal: 'HOSPEDAGEM', // Já que é um hotel
      
      // Remover campos com nomenclatura antiga (se existirem)
      nomeFornecedor: undefined,
      cnpjCpfFornecedor: undefined,
      
      // Metadados
      ultimaCorrecao: new Date().toISOString(),
      correcaoAplicada: {
        nomenclaturaCorrigida: true,
        categoriaPrincipalAdicionada: true,
        timestamp: new Date().toISOString()
      }
    };
    
    // Limpar campos undefined
    Object.keys(dadosCorrigidos).forEach(key => {
      if (dadosCorrigidos[key] === undefined) {
        delete dadosCorrigidos[key];
      }
    });
    
    console.log('\n✅ Dados corrigidos:');
    console.log(JSON.stringify(dadosCorrigidos, null, 2));
    
    // Confirmar execução
    const executar = process.argv.includes('--executar');
    
    if (executar) {
      console.log('\n💾 Salvando correções no Firestore...');
      
      // Atualizar apenas o subcampo "dados"
      await fornecedorRef.update({
        dados: dadosCorrigidos
      });
      
      console.log('✅ Fornecedor corrigido com sucesso!');
      
      // Verificar resultado
      const verificacao = await fornecedorRef.get();
      const dadosVerificacao = verificacao.data();
      
      console.log('\n🔍 Verificação pós-correção:');
      console.log('Nome:', dadosVerificacao.dados.nome);
      console.log('CNPJ/CPF:', dadosVerificacao.dados.cnpjCpf);
      console.log('Categoria Principal:', dadosVerificacao.dados.categoriaPrincipal);
      console.log('Última Correção:', dadosVerificacao.dados.ultimaCorrecao);
      
    } else {
      console.log('\n📝 Execução simulada. Use --executar para aplicar as correções.');
      console.log('\nPara executar de verdade:');
      console.log('node corrigir-fornecedor-especifico.cjs --executar');
    }
    
  } catch (error) {
    console.error('❌ Erro:', error);
  }
}

// Script para corrigir múltiplos fornecedores baseado no padrão encontrado
async function corrigirMultiplosFornecedores() {
  console.log('🚀 Corrigindo múltiplos fornecedores...\n');
  
  try {
    const fornecedoresQuery = db.collection('monitorgastos/fornecedores/lista').limit(10);
    const snapshot = await fornecedoresQuery.get();
    
    if (snapshot.empty) {
      console.log('❌ Nenhum fornecedor encontrado');
      return;
    }
    
    console.log(`📋 Encontrados ${snapshot.docs.length} fornecedores\n`);
    
    let sucessos = 0;
    let erros = 0;
    
    for (const doc of snapshot.docs) {
      const cnpj = doc.id;
      const fornecedorData = doc.data();
      const dados = fornecedorData.dados || {};
      
      console.log(`🔍 Processando ${cnpj} - ${dados.nome || 'SEM NOME'}`);
      
      try {
        // Determinar categoria principal baseada no nome
        let categoriaPrincipal = 'OUTROS';
        if (dados.nome) {
          const nome = dados.nome.toLowerCase();
          if (nome.includes('hotel') || nome.includes('pousada') || nome.includes('hospedagem')) {
            categoriaPrincipal = 'HOSPEDAGEM';
          } else if (nome.includes('transporte') || nome.includes('taxi') || nome.includes('uber') || nome.includes('locadora')) {
            categoriaPrincipal = 'TRANSPORTE';
          } else if (nome.includes('restaurante') || nome.includes('lanchonete') || nome.includes('alimentação')) {
            categoriaPrincipal = 'ALIMENTAÇÃO';
          } else if (nome.includes('consultoria') || nome.includes('assessoria') || nome.includes('serviços')) {
            categoriaPrincipal = 'CONSULTORIA';
          } else if (nome.includes('posto') || nome.includes('combustível') || nome.includes('gasolina')) {
            categoriaPrincipal = 'COMBUSTÍVEL';
          }
        }
        
        const dadosCorrigidos = {
          ...dados,
          
          // Garantir campos corretos
          nome: dados.nomeFornecedor || dados.nome || 'NOME NÃO DISPONÍVEL',
          cnpjCpf: dados.cnpjCpfFornecedor || dados.cnpjCpf || dados.id || cnpj,
          categoriaPrincipal: dados.categoriaPrincipal || categoriaPrincipal,
          
          // Remover nomenclatura antiga
          nomeFornecedor: undefined,
          cnpjCpfFornecedor: undefined,
          
          // Metadados
          ultimaCorrecao: new Date().toISOString()
        };
        
        // Limpar undefined
        Object.keys(dadosCorrigidos).forEach(key => {
          if (dadosCorrigidos[key] === undefined) {
            delete dadosCorrigidos[key];
          }
        });
        
        const executar = process.argv.includes('--executar');
        
        if (executar) {
          await doc.ref.update({ dados: dadosCorrigidos });
          console.log(`  ✅ ${dados.nome} -> Categoria: ${categoriaPrincipal}`);
        } else {
          console.log(`  📝 ${dados.nome} -> Categoria seria: ${categoriaPrincipal}`);
        }
        
        sucessos++;
        
      } catch (error) {
        console.log(`  ❌ Erro: ${error.message}`);
        erros++;
      }
      
      // Pausa entre processamentos
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    console.log(`\n📊 Resultado:`);
    console.log(`✅ Sucessos: ${sucessos}`);
    console.log(`❌ Erros: ${erros}`);
    
    if (!process.argv.includes('--executar')) {
      console.log('\n📝 Para executar de verdade: node corrigir-fornecedor-especifico.cjs --todos --executar');
    }
    
  } catch (error) {
    console.error('❌ Erro geral:', error);
  }
}

// Main
async function main() {
  if (process.argv.includes('--todos')) {
    await corrigirMultiplosFornecedores();
  } else {
    await corrigirFornecedorEspecifico();
  }
}

main().catch(console.error);