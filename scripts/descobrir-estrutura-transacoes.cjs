/**
 * Script para descobrir onde estão as transações reais no Firestore
 * e quais são os tipos de despesa reais
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

async function descobrirEstruturaTransacoes() {
  console.log('🔍 Descobrindo estrutura de transações no Firestore...\n');
  
  // Listar todas as coleções principais
  console.log('📂 Listando coleções principais:');
  try {
    const collections = await db.listCollections();
    console.log('Coleções encontradas:', collections.map(c => c.id));
  } catch (error) {
    console.log('❌ Erro ao listar coleções:', error.message);
  }
  
  console.log();
  
  // Investigar possíveis estruturas de transações
  const possiveisEstruturasTransacoes = [
    'monitorgastos',
    'despesas',
    'transacoes',
    'gastos-deputados',
    'deputados-despesas'
  ];
  
  for (const estrutura of possiveisEstruturasTransacoes) {
    console.log(`📂 Investigando: ${estrutura}`);
    
    try {
      // Se for um documento, listar suas subcoleções
      if (estrutura === 'monitorgastos') {
        const docRef = db.doc(estrutura + '/temp');
        const parentRef = docRef.parent.parent; // Voltar para o documento pai
        const parentDoc = db.doc(estrutura);
        
        try {
          const subcolections = await parentDoc.listCollections();
          console.log(`   Subcoleções em ${estrutura}:`, subcolections.map(c => c.id));
          
          // Investigar cada subcoleção
          for (const subcol of subcolections) {
            console.log(`   📁 Explorando ${estrutura}/${subcol.id}:`);
            
            try {
              const sampleQuery = subcol.limit(2);
              const sampleSnapshot = await sampleQuery.get();
              
              console.log(`      📊 Documentos: ${sampleSnapshot.docs.length}`);
              
              if (!sampleSnapshot.empty) {
                sampleSnapshot.docs.forEach((doc, index) => {
                  const data = doc.data();
                  console.log(`      [${index + 1}] ${doc.id}:`);
                  console.log(`         Campos:`, Object.keys(data).slice(0, 8));
                  
                  // Buscar campos relacionados a tipo de despesa
                  const camposTipo = Object.keys(data).filter(key => 
                    key.toLowerCase().includes('tipo') || 
                    key.toLowerCase().includes('despesa') ||
                    key.toLowerCase().includes('categoria')
                  );
                  
                  if (camposTipo.length > 0) {
                    console.log(`         Campos tipo/categoria:`, camposTipo.map(field => `${field}: ${data[field]}`));
                  }
                  
                  // Buscar campos de fornecedor
                  const camposFornecedor = Object.keys(data).filter(key => 
                    key.toLowerCase().includes('fornecedor') || 
                    key.toLowerCase().includes('cnpj') ||
                    key.toLowerCase().includes('cpf')
                  );
                  
                  if (camposFornecedor.length > 0) {
                    console.log(`         Campos fornecedor:`, camposFornecedor.map(field => `${field}: ${data[field]}`));
                  }
                });
              }
              
            } catch (subError) {
              console.log(`      ❌ Erro: ${subError.message}`);
            }
          }
          
        } catch (listError) {
          console.log(`   ❌ Erro ao listar subcoleções: ${listError.message}`);
        }
      } else {
        // Tentar como coleção direta
        const colecaoRef = db.collection(estrutura);
        const sampleQuery = colecaoRef.limit(2);
        const sampleSnapshot = await sampleQuery.get();
        
        console.log(`   📊 Documentos: ${sampleSnapshot.docs.length}`);
        
        if (!sampleSnapshot.empty) {
          sampleSnapshot.docs.forEach((doc, index) => {
            const data = doc.data();
            console.log(`   [${index + 1}] ${doc.id}:`);
            console.log(`      Campos:`, Object.keys(data).slice(0, 8));
            
            // Buscar campos relacionados a tipo de despesa
            const camposTipo = Object.keys(data).filter(key => 
              key.toLowerCase().includes('tipo') || 
              key.toLowerCase().includes('despesa')
            );
            
            if (camposTipo.length > 0) {
              console.log(`      Tipos de despesa:`, camposTipo.map(field => `${field}: ${data[field]}`));
            }
          });
        }
      }
      
    } catch (error) {
      console.log(`   ❌ Erro: ${error.message}`);
    }
    
    console.log();
  }
  
  // Buscar especificamente por transações do HOTEL GIRASSOL PLAZA
  console.log('🎯 Buscando transações específicas do HOTEL GIRASSOL PLAZA:');
  const cnpjHotel = '00082535000159';
  const nomeHotel = 'HOTEL GIRASSOL PLAZA';
  
  // Tentar diferentes estruturas e campos
  const tentativas = [
    { colecao: 'monitorgastos/despesas-consolidadas/consolidado', campos: ['cpfCnpj', 'fornecedorCnpj'] },
    { colecao: 'monitorgastos/despesas/dados', campos: ['cpfCnpj', 'cnpjFornecedor'] },
    { colecao: 'despesas', campos: ['cpfCnpj', 'cnpj'] },
    { colecao: 'transacoes', campos: ['fornecedorCnpj', 'cnpj'] }
  ];
  
  for (const { colecao, campos } of tentativas) {
    console.log(`🔎 Tentando ${colecao}:`);
    
    for (const campo of campos) {
      try {
        const query = db.collection(colecao).where(campo, '==', cnpjHotel).limit(3);
        const snapshot = await query.get();
        
        if (!snapshot.empty) {
          console.log(`   ✅ ENCONTRADO! ${snapshot.docs.length} transações via ${campo}`);
          
          snapshot.docs.forEach((doc, index) => {
            const data = doc.data();
            console.log(`   [${index + 1}] ${doc.id}:`);
            console.log(`      Nome fornecedor: ${data.nomeFornecedor || data.nomeDoFornecedor || data.nome || 'N/A'}`);
            console.log(`      Tipo Despesa: ${data.tipoDespesa || data.tipoGasto || data.categoria || 'N/A'}`);
            console.log(`      Valor: ${data.valorLiquido || data.valor || 'N/A'}`);
            console.log(`      Ano: ${data.ano || 'N/A'}`);
            
            // Mostrar todos os campos que contêm "tipo"
            const camposTipo = Object.keys(data).filter(k => k.toLowerCase().includes('tipo'));
            if (camposTipo.length > 0) {
              console.log(`      Campos 'tipo':`, camposTipo.map(k => `${k}: ${data[k]}`));
            }
          });
          
          break; // Parar na primeira tentativa bem-sucedida
        } else {
          console.log(`   ❌ Nenhuma transação encontrada via ${campo}`);
        }
        
      } catch (error) {
        console.log(`   ⚠️ Erro ao buscar via ${campo}: ${error.message}`);
      }
    }
  }
  
  // Também tentar busca por nome do fornecedor
  console.log('\n🔎 Tentando busca por nome do fornecedor:');
  const tentativasNome = [
    { colecao: 'monitorgastos/despesas-consolidadas/consolidado', campo: 'nomeFornecedor' },
    { colecao: 'monitorgastos/despesas/dados', campo: 'nomeDoFornecedor' }
  ];
  
  for (const { colecao, campo } of tentativasNome) {
    try {
      console.log(`🔎 Buscando em ${colecao} por ${campo} = "${nomeHotel}"`);
      const query = db.collection(colecao).where(campo, '==', nomeHotel).limit(2);
      const snapshot = await query.get();
      
      if (!snapshot.empty) {
        console.log(`   ✅ ENCONTRADO! ${snapshot.docs.length} transações`);
        
        snapshot.docs.forEach((doc, index) => {
          const data = doc.data();
          console.log(`   [${index + 1}] Tipo Despesa: ${data.tipoDespesa || 'N/A'}`);
          console.log(`       Valor: ${data.valorLiquido || data.valor || 'N/A'}`);
          console.log(`       CNPJ: ${data.cpfCnpj || data.cnpj || 'N/A'}`);
        });
      } else {
        console.log(`   ❌ Nenhuma transação encontrada por nome`);
      }
      
    } catch (error) {
      console.log(`   ⚠️ Erro: ${error.message}`);
    }
  }
}

// Executar descoberta
descobrirEstruturaTransacoes().catch(console.error);