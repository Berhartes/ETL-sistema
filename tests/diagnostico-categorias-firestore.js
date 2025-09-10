/**
 * Diagnóstico detalhado das categorias no Firestore
 * 
 * Este script vai investigar:
 * 1. Quais documentos de ranking realmente existem
 * 2. Quais categorias existem nas transações
 * 3. Por que algumas categorias estão "perdidas"
 */

// Simular uma busca no console do Firestore
console.log('🔍 DIAGNÓSTICO DETALHADO DAS CATEGORIAS NO FIRESTORE\n');

// Lista de categorias que aparecem na interface
const categoriasInterface = [
  'Aquisição de Tokens e Certificados Digitais',
  'Assinatura de Publicações',
  'Combustíveis e Lubrificantes',
  'Consultorias, Pesquisas e Trabalhos Técnicos',
  'Divulgação da Atividade Parlamentar',
  'Fornecimento de Alimentação do Parlamentar',
  'Hospedagem (Exceto do Parlamentar no Distrito Federal)',
  'Locação ou Fretamento de Aeronaves',
  'Locação ou Fretamento de Embarcações',
  'Locação ou Fretamento de Veículos Automotores',
  'Manutenção de Escritório de Apoio à Atividade Parlamentar',
  'Participação em Curso, Palestra ou Evento Similar',
  'Passagem Aérea - RPA',
  'Passagem Aérea - Reembolso',
  'Passagem Aérea - SIGEPA',
  'Passagens Terrestres, Marítimas ou Fluviais',
  'Serviço de Segurança Prestado por Empresa Especializada',
  'Serviço de Táxi, Pedágio e Estacionamento',
  'Serviços Postais',
  'Telefonia'
];

// Função para normalizar (mesma do sistema)
function normalizar(categoria) {
  return categoria
    .toLowerCase()
    .replace(/[àáâãäå]/g, 'a')
    .replace(/[èéêë]/g, 'e')
    .replace(/[ìíîï]/g, 'i')
    .replace(/[òóôõö]/g, 'o')
    .replace(/[ùúûü]/g, 'u')
    .replace(/[ç]/g, 'c')
    .replace(/[^a-z0-9]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
}

// Documentos que sabemos que existem (verificados anteriormente)
const documentosExistentes = [
  'deputados_combustiveis_e_lubrificantes_historico',
  'deputados_divulgacao_da_atividade_parlamentar_historico',
  'deputados_manutencao_de_escritorio_de_apoio_a_atividade_parlamentar_historico',
  'deputados_fornecimento_de_alimentacao_do_parlamentar_historico',
  'deputados_servicos_postais_historico',
  'deputados_telefonia_historico',
  'deputados_locacao_ou_fretamento_de_veiculos_historico',
  'deputados_passagens_aereas_historico',
  'deputados_hospedagem_historico',
  'deputados_consultorias_assessorias_pesquisas_e_trabalhos_tecnicos_historico'
];

console.log('📊 PARTE 1: Análise das categorias da interface\n');

const resultadosAnalise = [];

categoriasInterface.forEach((categoria, index) => {
  const normalizada = normalizar(categoria);
  const docIdHistorico = `deputados_${normalizada}_historico`;
  const docId2025 = `deputados_${normalizada}_2025`;
  
  const existeHistorico = documentosExistentes.includes(docIdHistorico);
  
  const resultado = {
    categoria,
    normalizada,
    docIdHistorico,
    docId2025,
    existeHistorico,
    status: existeHistorico ? '✅ EXISTE' : '❌ NÃO EXISTE'
  };
  
  resultadosAnalise.push(resultado);
  
  console.log(`${index + 1}. "${categoria}"`);
  console.log(`   Normalizada: "${normalizada}"`);
  console.log(`   Doc histórico: "${docIdHistorico}"`);
  console.log(`   Status: ${resultado.status}`);
  
  if (!existeHistorico) {
    // Tentar encontrar similaridades
    const similares = documentosExistentes.filter(doc => {
      const docSemPrefixo = doc.replace('deputados_', '').replace('_historico', '');
      const palavrasCategoria = normalizada.split('_');
      const palavrasDoc = docSemPrefixo.split('_');
      
      return palavrasCategoria.some(palavra => 
        palavrasDoc.some(docPalavra => 
          docPalavra.includes(palavra) || palavra.includes(docPalavra)
        )
      );
    });
    
    if (similares.length > 0) {
      console.log(`   Possível correspondência: ${similares[0]}`);
    }
  }
  
  console.log('');
});

console.log('\n📊 PARTE 2: Resumo da análise\n');

const existentes = resultadosAnalise.filter(r => r.existeHistorico);
const naoExistentes = resultadosAnalise.filter(r => !r.existeHistorico);

console.log(`✅ Categorias com documentos (${existentes.length}/${categoriasInterface.length}):`);
existentes.forEach(cat => {
  console.log(`   - ${cat.categoria}`);
});

console.log(`\n❌ Categorias sem documentos (${naoExistentes.length}/${categoriasInterface.length}):`);
naoExistentes.forEach(cat => {
  console.log(`   - ${cat.categoria}`);
});

console.log('\n📊 PARTE 3: Análise dos padrões\n');

// Verificar padrões nas categorias inexistentes
console.log('🔍 Padrões identificados nas categorias inexistentes:');

const comHifen = naoExistentes.filter(cat => cat.categoria.includes(' - '));
if (comHifen.length > 0) {
  console.log(`\n1. Categorias com hífen (${comHifen.length}):`);
  comHifen.forEach(cat => {
    console.log(`   - ${cat.categoria}`);
  });
  console.log('   💡 Suspeita: Podem ser subcategorias que deveriam ser agrupadas');
}

const comParenteses = naoExistentes.filter(cat => cat.categoria.includes('('));
if (comParenteses.length > 0) {
  console.log(`\n2. Categorias com parênteses (${comParenteses.length}):`);
  comParenteses.forEach(cat => {
    console.log(`   - ${cat.categoria}`);
  });
  console.log('   💡 Suspeita: Podem ser especificações que deveriam usar categoria base');
}

const locacao = naoExistentes.filter(cat => cat.categoria.includes('Locação ou Fretamento'));
if (locacao.length > 0) {
  console.log(`\n3. Variações de Locação/Fretamento (${locacao.length}):`);
  locacao.forEach(cat => {
    console.log(`   - ${cat.categoria}`);
  });
  console.log('   💡 Suspeita: Deveriam usar "deputados_locacao_ou_fretamento_de_veiculos_historico"');
}

console.log('\n📊 PARTE 4: Investigação das possíveis causas\n');

console.log('🔍 Possíveis razões para categorias não encontradas:');
console.log('');
console.log('1. 📋 PROCESSO ETL INCOMPLETO:');
console.log('   - Algumas categorias podem não ter sido processadas');
console.log('   - Rankings podem não ter sido gerados para todas as categorias');
console.log('   - Verificar logs do processo de geração de rankings');
console.log('');
console.log('2. 🏷️ INCONSISTÊNCIA DE NOMES:');
console.log('   - Nomes na interface vs nomes nos dados originais');
console.log('   - Mudanças nos nomes das categorias ao longo do tempo');
console.log('   - Normalização diferente entre sistemas');
console.log('');
console.log('3. 📊 VOLUME DE DADOS INSUFICIENTE:');
console.log('   - Categorias com poucas transações podem não gerar rankings');
console.log('   - Filtros de volume mínimo no processo ETL');
console.log('   - Verificar se existem transações para essas categorias');
console.log('');
console.log('4. 🗂️ AGRUPAMENTO DE SUBCATEGORIAS:');
console.log('   - Subcategorias podem estar sendo agrupadas');
console.log('   - "Passagem Aérea - RPA" pode estar em "Passagens Aéreas"');
console.log('   - "Hospedagem (Exceto...)" pode estar em "Hospedagem"');

console.log('\n📊 PARTE 5: Próximos passos para investigação\n');

console.log('🔍 Para resolver o mistério das categorias perdidas:');
console.log('');
console.log('1. 🗃️ VERIFICAR COLEÇÃO DE TRANSAÇÕES:');
console.log('   - Listar todas as categorias únicas nas transações');
console.log('   - Verificar se as categorias "perdidas" existem nos dados brutos');
console.log('   - Comando: db.transacoes.distinct("categoria")');
console.log('');
console.log('2. 📋 VERIFICAR COLEÇÃO DE RANKINGS:');
console.log('   - Listar todos os documentos na coleção rankings');
console.log('   - Verificar padrões de nomenclatura');
console.log('   - Comando: db.rankings.find().map(doc => doc._id)');
console.log('');
console.log('3. 🔄 VERIFICAR PROCESSO ETL:');
console.log('   - Logs de geração de rankings');
console.log('   - Verificar se todas as categorias são processadas');
console.log('   - Verificar critérios de filtro (volume mínimo, etc.)');
console.log('');
console.log('4. 🧪 TESTE ESPECÍFICO:');
console.log('   - Buscar transações para uma categoria "perdida"');
console.log('   - Verificar se consegue gerar ranking manualmente');
console.log('   - Exemplo: "Aquisição de Tokens e Certificados Digitais"');

console.log('\n✅ Diagnóstico concluído!');
console.log('\nPróximo passo: Investigar no console do Firestore ou via script conectado ao banco.');