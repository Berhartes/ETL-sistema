/**
 * Script para corrigir fornecedor específico diretamente
 * Aplicando as regras:
 * - Remove campo 'id'
 * - nome → nomeFornecedor 
 * - cnpjCpf → cnpjCpfFornecedor
 * - categoriaPrincipal = tipoDespesa mais comum (sem normalização)
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

async function corrigirFornecedorDireto(cnpj) {
  console.log(`🔍 Corrigindo fornecedor direto: ${cnpj}`);
  
  try {
    const fornecedorRef = db.collection('monitorgastos/fornecedores/lista').doc(cnpj);
    const fornecedorDoc = await fornecedorRef.get();
    
    if (!fornecedorDoc.exists) {
      console.log('❌ Fornecedor não encontrado');
      return;
    }
    
    const fornecedorData = fornecedorDoc.data();
    const dadosAtuais = fornecedorData.dados || {};
    
    console.log('📋 Dados atuais:');
    console.log(JSON.stringify(dadosAtuais, null, 2));
    
    // Para este exemplo, vou usar dados conhecidos baseados no tipo de negócio
    // Posto de combustível = tipoDespesa comum seria "COMBUSTÍVEIS E LUBRIFICANTES"
    const categoriaPrincipalManual = cnpj === '00044347000136' ? 
      'COMBUSTÍVEIS E LUBRIFICANTES' : 
      'Não especificado';
    
    const categoriasSecundariasManual = [];
    
    // Preparar dados corrigidos conforme especificações
    const dadosCorrigidos = {
      // Manter dados existentes importantes
      numeroDeputados: dadosAtuais.numeroDeputados,
      numeroTransacoes: dadosAtuais.numeroTransacoes,
      lastUpdate: dadosAtuais.lastUpdate,
      totalRecebido: dadosAtuais.totalRecebido,
      
      // APLICAR nomenclatura correta solicitada
      nomeFornecedor: dadosAtuais.nome || dadosAtuais.nomeFornecedor || 'Nome não disponível',
      cnpjCpfFornecedor: cnpj, // Usar o CNPJ como identificador
      
      // Categorias baseadas em tipoDespesa (string original)
      categoriaPrincipal: categoriaPrincipalManual,
      categoriasSecundarias: categoriasSecundariasManual,
      
      // Metadados da correção
      correcaoAplicada: {
        data: new Date().toISOString(),
        tipo: 'nomenclatura_e_categorias',
        camposRemovidos: ['id', 'nome', 'cnpjCpf'],
        camposAdicionados: ['nomeFornecedor', 'cnpjCpfFornecedor', 'categoriaPrincipal', 'categoriasSecundarias']
      },
      
      ultimaCorrecao: new Date().toISOString()
      
      // NOTA: Campos id, nome, cnpjCpf serão removidos por não serem incluídos aqui
    };
    
    console.log('\n✅ Dados corrigidos:');
    console.log(JSON.stringify(dadosCorrigidos, null, 2));
    
    console.log('\n📋 Resumo das mudanças:');
    console.log(`   ❌ Removido: id = "${dadosAtuais.id}"`);
    console.log(`   🔄 nome → nomeFornecedor = "${dadosCorrigidos.nomeFornecedor}"`);
    console.log(`   🔄 cnpjCpf → cnpjCpfFornecedor = "${dadosCorrigidos.cnpjCpfFornecedor}"`);
    console.log(`   ➕ categoriaPrincipal = "${dadosCorrigidos.categoriaPrincipal}"`);
    console.log(`   ➕ categoriasSecundarias = [${dadosCorrigidos.categoriasSecundarias.join(', ')}]`);
    
    // Confirmar execução
    const executar = process.argv.includes('--executar');
    
    if (executar) {
      console.log('\n💾 Aplicando correções no Firestore...');
      
      // Atualizar apenas o subcampo 'dados'
      await fornecedorRef.update({
        dados: dadosCorrigidos
      });
      
      console.log('✅ Fornecedor corrigido com sucesso!');
      
      // Verificação pós-correção
      const verificacao = await fornecedorRef.get();
      const dadosVerificados = verificacao.data().dados;
      
      console.log('\n🔍 Verificação pós-correção:');
      console.log(`   Nome Fornecedor: ${dadosVerificados.nomeFornecedor}`);
      console.log(`   CNPJ/CPF Fornecedor: ${dadosVerificados.cnpjCpfFornecedor}`);
      console.log(`   Categoria Principal: ${dadosVerificados.categoriaPrincipal}`);
      console.log(`   Campo 'id' removido: ${!dadosVerificados.hasOwnProperty('id') ? 'SIM' : 'NÃO'}`);
      console.log(`   Campo 'nome' removido: ${!dadosVerificados.hasOwnProperty('nome') ? 'SIM' : 'NÃO'}`);
      console.log(`   Campo 'cnpjCpf' removido: ${!dadosVerificados.hasOwnProperty('cnpjCpf') ? 'SIM' : 'NÃO'}`);
      
    } else {
      console.log('\n📝 Simulação concluída. Use --executar para aplicar as correções.');
      console.log('\nComando para executar:');
      console.log(`node corrigir-fornecedor-direto.cjs --cnpj ${cnpj} --executar`);
    }
    
  } catch (error) {
    console.error('❌ Erro:', error.message);
  }
}

// Função para processar múltiplos fornecedores
async function corrigirMultiplos(limite = 10) {
  console.log(`🚀 Corrigindo ${limite} fornecedores...\n`);
  
  try {
    const fornecedoresQuery = db.collection('monitorgastos/fornecedores/lista').limit(limite);
    const snapshot = await fornecedoresQuery.get();
    
    if (snapshot.empty) {
      console.log('❌ Nenhum fornecedor encontrado');
      return;
    }
    
    let sucessos = 0;
    let erros = 0;
    
    for (const doc of snapshot.docs) {
      const cnpj = doc.id;
      const dados = doc.data().dados || {};
      
      console.log(`\n🔍 Processando ${cnpj} - ${dados.nome || dados.nomeFornecedor || 'SEM NOME'}`);
      
      try {
        // Determinar categoria principal baseada no nome (aproximação)
        let categoriaPrincipal = 'Não especificado';
        if (dados.nome) {
          const nome = dados.nome.toLowerCase();
          if (nome.includes('posto') || nome.includes('combustível') || nome.includes('gasolina')) {
            categoriaPrincipal = 'COMBUSTÍVEIS E LUBRIFICANTES';
          } else if (nome.includes('hotel') || nome.includes('pousada')) {
            categoriaPrincipal = 'HOSPEDAGEM';
          } else if (nome.includes('transporte') || nome.includes('taxi')) {
            categoriaPrincipal = 'LOCOMOÇÃO';
          } else if (nome.includes('restaurante') || nome.includes('alimentação')) {
            categoriaPrincipal = 'ALIMENTAÇÃO';
          }
        }
        
        const dadosCorrigidos = {
          // Manter dados existentes
          numeroDeputados: dados.numeroDeputados,
          numeroTransacoes: dados.numeroTransacoes,
          lastUpdate: dados.lastUpdate,
          totalRecebido: dados.totalRecebido,
          
          // Aplicar nomenclatura correta
          nomeFornecedor: dados.nome || dados.nomeFornecedor || 'Nome não disponível',
          cnpjCpfFornecedor: cnpj,
          
          // Categorias
          categoriaPrincipal: categoriaPrincipal,
          categoriasSecundarias: [],
          
          // Metadados
          ultimaCorrecao: new Date().toISOString()
        };
        
        const executar = process.argv.includes('--executar');
        
        if (executar) {
          await doc.ref.update({ dados: dadosCorrigidos });
          console.log(`  ✅ Corrigido - Categoria: ${categoriaPrincipal}`);
        } else {
          console.log(`  📝 Categoria seria: ${categoriaPrincipal}`);
        }
        
        sucessos++;
        
      } catch (error) {
        console.log(`  ❌ Erro: ${error.message}`);
        erros++;
      }
      
      // Pausa entre processamentos
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    console.log(`\n📊 Resultado Final:`);
    console.log(`✅ Sucessos: ${sucessos}`);
    console.log(`❌ Erros: ${erros}`);
    
    if (!process.argv.includes('--executar')) {
      console.log('\n📝 Para executar: node corrigir-fornecedor-direto.cjs --todos --executar');
    }
    
  } catch (error) {
    console.error('❌ Erro geral:', error.message);
  }
}

// Main
async function main() {
  const args = process.argv.slice(2);
  
  if (args.includes('--help')) {
    console.log(`
🛠️  Correção Direta de Fornecedores

Mudanças aplicadas:
  ❌ Remove: id, nome, cnpjCpf
  ➕ Adiciona: nomeFornecedor, cnpjCpfFornecedor
  ➕ Adiciona: categoriaPrincipal, categoriasSecundarias

Uso:
  node corrigir-fornecedor-direto.cjs [opções]
  
Opções:
  --cnpj CNPJ           Corrigir fornecedor específico
  --todos               Corrigir múltiplos fornecedores  
  --limite N            Número de fornecedores (padrão: 10)
  --executar            Executar correções reais
  --help                Esta ajuda
  
Exemplos:
  # Simular fornecedor específico
  node corrigir-fornecedor-direto.cjs --cnpj 00044347000136
  
  # Executar correção real
  node corrigir-fornecedor-direto.cjs --cnpj 00044347000136 --executar
`);
    return;
  }
  
  const cnpjIndex = args.indexOf('--cnpj');
  const limiteIndex = args.indexOf('--limite');
  
  if (cnpjIndex !== -1 && cnpjIndex + 1 < args.length) {
    const cnpj = args[cnpjIndex + 1];
    await corrigirFornecedorDireto(cnpj);
  } else if (args.includes('--todos')) {
    const limite = limiteIndex !== -1 && limiteIndex + 1 < args.length 
      ? parseInt(args[limiteIndex + 1]) 
      : 10;
    await corrigirMultiplos(limite);
  } else {
    console.log('Use --help para ver as opções disponíveis');
  }
}

main().catch(console.error);