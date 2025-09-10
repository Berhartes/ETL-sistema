/**
 * Script para ajustar categoria do HOTEL GIRASSOL PLAZA
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

async function ajustarCategoriaHotel() {
  const cnpj = '00082535000159';
  console.log(`🏨 Ajustando categoria do HOTEL GIRASSOL PLAZA (${cnpj})`);
  
  try {
    const fornecedorRef = db.collection('monitorgastos/fornecedores/lista').doc(cnpj);
    const fornecedorDoc = await fornecedorRef.get();
    
    if (!fornecedorDoc.exists) {
      console.log('❌ Fornecedor não encontrado');
      return;
    }
    
    const fornecedorData = fornecedorDoc.data();
    const dadosAtuais = fornecedorData.dados;
    
    // Atualizar apenas a categoria principal para "HOSPEDAGEM"
    const dadosAtualizados = {
      ...dadosAtuais,
      categoriaPrincipal: 'HOSPEDAGEM',
      ultimaCorrecao: new Date().toISOString(),
      ajusteCategoria: {
        anterior: 'Não especificado',
        nova: 'HOSPEDAGEM',
        motivo: 'Hotel = categoria HOSPEDAGEM',
        data: new Date().toISOString()
      }
    };
    
    console.log('🔄 Atualizando categoria:');
    console.log(`   Anterior: "${dadosAtuais.categoriaPrincipal}"`);
    console.log(`   Nova: "HOSPEDAGEM"`);
    
    // Aplicar atualização
    await fornecedorRef.update({
      dados: dadosAtualizados
    });
    
    console.log('✅ Categoria do hotel atualizada com sucesso!');
    
    // Verificar
    const verificacao = await fornecedorRef.get();
    const dadosVerificados = verificacao.data().dados;
    console.log(`🔍 Verificação: categoriaPrincipal = "${dadosVerificados.categoriaPrincipal}"`);
    
  } catch (error) {
    console.error('❌ Erro:', error.message);
  }
}

ajustarCategoriaHotel().catch(console.error);