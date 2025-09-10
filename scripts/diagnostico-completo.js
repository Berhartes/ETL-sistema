/**
 * 🔍 DIAGNÓSTICO COMPLETO - SCRIPT UNIFICADO
 * 
 * INSTRUÇÕES:
 * 1. Abra http://localhost:5173/gastos/fornecedores
 * 2. Pressione F12 para abrir o Console
 * 3. Copie e cole TODO este arquivo no console
 * 4. Execute: diagnosticoCompleto()
 */

console.log('🔍 [DIAGNÓSTICO] Script unificado carregado');

async function diagnosticoCompleto() {
  console.log('🚀 [DIAGNÓSTICO] Iniciando diagnóstico completo...');
  
  if (typeof window === 'undefined' || !window.firebase) {
    console.error('❌ Firebase não disponível - certifique-se de estar em http://localhost:5173/gastos/fornecedores');
    return;
  }

  const db = window.firebase.firestore();
  
  try {
    console.log('\n📊 === PARTE 1: ESTRUTURAS PRINCIPAIS ===');
    
    // 1. Verificar coleções principais
    const collections = ['deputados', 'fornecedores', 'perfisFornecedores', 'rankings', 'despesas'];
    
    for (const collectionName of collections) {
      try {
        const snapshot = await db.collection(collectionName).limit(1).get();
        console.log(`${snapshot.empty ? '❌' : '✅'} ${collectionName}: ${snapshot.empty ? 'VAZIO' : 'TEM DADOS'}`);
        
        if (!snapshot.empty) {
          const doc = snapshot.docs[0];
          const data = doc.data();
          console.log(`   📄 Exemplo: ${doc.id}`);
          console.log(`   🔑 Campos: ${Object.keys(data).slice(0, 5).join(', ')}`);
        }
      } catch (error) {
        console.log(`❌ ${collectionName}: ERRO - ${error.message}`);
      }
    }
    
    console.log('\n📊 === PARTE 2: FORNECEDORES ESPECÍFICOS ===');
    
    // 2. Testar fornecedores específicos
    try {
      const perfisRef = db.collection('perfisFornecedores');
      const perfisSnapshot = await perfisRef.limit(5).get();
      
      console.log(`📊 perfisFornecedores: ${perfisSnapshot.size} documentos`);
      
      if (perfisSnapshot.size > 0) {
        console.log('✅ DADOS ENCONTRADOS em perfisFornecedores:');
        
        perfisSnapshot.forEach((doc, index) => {
          const data = doc.data();
          console.log(`\n   ${index + 1}. "${data.nome || 'Sem nome'}"`);
          console.log(`      CNPJ: ${data.cnpj || 'Sem CNPJ'}`);
          console.log(`      Total: R$ ${(data.totalRecebido || data.totalTransacionado || 0).toLocaleString('pt-BR')}`);
          console.log(`      Deputados: ${data.deputadosAtendidos?.length || data.relacionamentoDeputados?.length || 0}`);
          console.log(`      Categorias: ${JSON.stringify(data.categorias?.slice(0,2) || data.servicosCategorizados?.categoriasAtendidas?.slice(0,2) || [])}`);
          console.log(`      Score: ${data.scoreInvestigativo || data.scores?.scoreGeral || data.indiceSuspeicao || 0}`);
        });
        
        // Testar o fornecedor específico problema
        console.log('\n🎯 === TESTANDO FORNECEDOR ESPECÍFICO ===');
        const cnpjTeste = '08840678000194';
        console.log(`Procurando por: ${cnpjTeste}`);
        
        const fornecedorQuery = perfisRef.where('cnpj', '==', cnpjTeste);
        const fornecedorSnapshot = await fornecedorQuery.get();
        
        if (!fornecedorSnapshot.empty) {
          console.log(`✅ ENCONTRADO: ${cnpjTeste}`);
          const fornecedorData = fornecedorSnapshot.docs[0].data();
          console.log('📊 Dados completos:', {
            nome: fornecedorData.nome,
            cnpj: fornecedorData.cnpj,
            totalRecebido: fornecedorData.totalRecebido,
            deputadosAtendidos: fornecedorData.deputadosAtendidos,
            relacionamentoDeputados: fornecedorData.relacionamentoDeputados,
            categorias: fornecedorData.categorias,
            servicosCategorizados: fornecedorData.servicosCategorizados
          });
        } else {
          console.log(`❌ NÃO ENCONTRADO: ${cnpjTeste}`);
          
          // Testar variações
          const variacoes = ['08.840.678/0001-94', '8840678000194', '8.840.678/0001-94'];
          console.log('🔍 Testando variações...');
          
          for (const variacao of variacoes) {
            const varQuery = perfisRef.where('cnpj', '==', variacao);
            const varSnapshot = await varQuery.get();
            
            if (!varSnapshot.empty) {
              console.log(`✅ ENCONTRADO com variação: ${variacao}`);
              break;
            } else {
              console.log(`❌ Não encontrado: ${variacao}`);
            }
          }
        }
        
      } else {
        console.log('❌ NENHUM DADO em perfisFornecedores');
      }
      
    } catch (error) {
      console.error('❌ Erro ao testar fornecedores:', error);
    }
    
    console.log('\n📊 === PARTE 3: ESTRUTURA HIERÁRQUICA ===');
    
    // 3. Testar estrutura hierárquica
    try {
      const despesasDoc = await db.collection('despesas').doc('fornecedores').get();
      
      if (despesasDoc.exists()) {
        console.log('✅ ESTRUTURA HIERÁRQUICA EXISTE: despesas/fornecedores');
        
        const cnpjsTeste = ['08840678000194', '00097626000320', '13712435000100'];
        
        for (const cnpj of cnpjsTeste) {
          try {
            const perfilPath = `despesas/fornecedores/${cnpj}/dados/perfil`;
            const perfilDoc = await db.doc(perfilPath).get();
            
            if (perfilDoc.exists()) {
              console.log(`✅ Perfil hierárquico encontrado: ${cnpj}`);
              const data = perfilDoc.data();
              console.log(`   Nome: ${data.nome}, Total: R$ ${(data.totalRecebido || 0).toLocaleString('pt-BR')}`);
            } else {
              console.log(`❌ Perfil hierárquico não encontrado: ${cnpj}`);
            }
          } catch (error) {
            console.log(`❌ Erro perfil ${cnpj}: ${error.message}`);
          }
        }
      } else {
        console.log('❌ ESTRUTURA HIERÁRQUICA NÃO EXISTE');
      }
    } catch (error) {
      console.error('❌ Erro estrutura hierárquica:', error);
    }
    
    console.log('\n📊 === CONCLUSÕES ===');
    console.log('1. Se perfisFornecedores tem dados → ETL funcionou');
    console.log('2. Se fornecedor específico existe → problema na busca/conversão');
    console.log('3. Se nenhum dado existe → ETL não salvou ou salvou em outro lugar');
    console.log('\n✅ Diagnóstico completo finalizado!');
    
  } catch (error) {
    console.error('❌ ERRO GERAL:', error);
  }
}

// Disponibilizar função
if (typeof window !== 'undefined') {
  window.diagnosticoCompleto = diagnosticoCompleto;
  
  console.log('\n🎯 PRONTO PARA USO!');
  console.log('📋 Execute no console: diagnosticoCompleto()');
  console.log('⚡ Ou clique aqui: ');
  console.log('%c diagnosticoCompleto() ', 'background: #4CAF50; color: white; padding: 5px; border-radius: 3px; font-weight: bold;');
}