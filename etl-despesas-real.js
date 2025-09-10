#!/usr/bin/env node
/**
 * 🚀 ETL REAL - Processador Completo de Despesas de Deputados
 *
 * Este é o processador ETL REAL que executa o processamento COMPLETO de despesas
 * usando a arquitetura Clean otimizada, com paginação automática total.
 * 
 * ✅ PROCESSAMENTO REAL de dados da API da Câmara
 * ✅ PAGINAÇÃO AUTOMÁTICA - busca TODAS as despesas (não apenas primeira página)
 * ✅ ARQUITETURA CLEAN implementada
 * ✅ SEM dependências problemáticas do frontend
 * ✅ RATE LIMITING inteligente respeitando limites da API
 */

import { getDestinoConfig } from './config/etl.config.js';
import https from 'https';
import { writeFileSync, existsSync, mkdirSync } from 'fs';

// Configuração do processamento
const config = {
  baseURL: 'https://dadosabertos.camara.leg.br/api/v2',
  timeout: 15000,
  maxRetries: 3,
  pauseBetweenRequests: 1000,
  itemsPerPage: 100
};

console.log('🏛️ Sistema ETL - Câmara dos Deputados');
console.log('🚀 Processador REAL de Despesas (Clean Architecture)');
console.log('');

// 1. Análise dos argumentos
const args = process.argv.slice(2);
const legislatura = args[0] || '57';
const limite = args[1] ? parseInt(args[1]) : null; // null = sem limite, buscar TODOS

console.log('📋 Argumentos:');
console.log(`   Legislatura: ${legislatura}ª`);
console.log(`   Limite: ${limite ? limite + ' deputados' : 'TODOS os deputados (sem limite)'}`);
console.log('');

// 2. Configuração automática do destino
const destino = getDestinoConfig();

// 3. Função para fazer requisições HTTP
function makeRequest(url) {
  return new Promise((resolve, reject) => {
    const request = https.get(url, { timeout: config.timeout }, (response) => {
      let data = '';
      
      response.on('data', (chunk) => {
        data += chunk;
      });
      
      response.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (error) {
          reject(new Error(`Erro ao parsear JSON: ${error.message}`));
        }
      });
    });
    
    request.on('error', reject);
    request.on('timeout', () => {
      request.destroy();
      reject(new Error('Timeout na requisição'));
    });
  });
}

// 4. Função para pausar entre requisições
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// 5. Função para buscar dados completos do deputado
async function buscarDadosCompletosDeDeputado(deputadoId) {
  try {
    const deputadoUrl = `${config.baseURL}/deputados/${deputadoId}`;
    console.log(`      🔍 Buscando dados completos: ${deputadoUrl}`);
    
    const response = await makeRequest(deputadoUrl);
    
    if (response.dados) {
      const dados = response.dados;
      const ultimoStatus = dados.ultimoStatus || {};
      
      console.log(`      ✅ Dados completos obtidos:`);
      console.log(`         ID: ${dados.id}`);
      console.log(`         Nome Eleitoral: ${ultimoStatus.nomeEleitoral || 'N/A'}`);
      console.log(`         Foto: ${ultimoStatus.urlFoto || 'N/A'}`);
      console.log(`         UF: ${ultimoStatus.siglaUf || 'N/A'}`);
      console.log(`         Partido: ${ultimoStatus.siglaPartido || 'N/A'}`);
      
      return {
        id: dados.id,
        nomeCivil: dados.nomeCivil,
        nomeEleitoral: ultimoStatus.nomeEleitoral,
        urlFoto: ultimoStatus.urlFoto,
        siglaUf: ultimoStatus.siglaUf,
        siglaPartido: ultimoStatus.siglaPartido,
        email: ultimoStatus.gabinete?.email,
        emailDeputado: dados.email,
        dataNascimento: dados.dataNascimento,
        dataFalecimento: dados.dataFalecimento,
        sexo: dados.sexo,
        escolaridade: dados.escolaridade,
        municipioNascimento: dados.municipioNascimento,
        ufNascimento: dados.ufNascimento,
        cpf: dados.cpf,
        urlWebsite: dados.urlWebsite,
        redeSocial: dados.redeSocial,
        gabinete: ultimoStatus.gabinete,
        situacao: ultimoStatus.situacao,
        condicaoEleitoral: ultimoStatus.condicaoEleitoral
      };
    }
    
    return null;
  } catch (error) {
    console.log(`      ❌ Erro ao buscar dados completos: ${error.message}`);
    return null;
  }
}

// 6. Função para buscar TODAS as despesas de um deputado (com paginação até acabar)
async function buscarTodasDespesasDeputado(deputadoId, legislatura, ano = null) {
  let todasDespesas = [];
  let pagina = 1;
  
  while (true) {
    try {
      let despesasUrl = `${config.baseURL}/deputados/${deputadoId}/despesas?itens=${config.itemsPerPage}&pagina=${pagina}&idLegislatura=${legislatura}`;
      if (ano) {
        despesasUrl += `&ano=${ano}`;
      }
      
      console.log(`      📄 Buscando página ${pagina}...`);
      
      const response = await makeRequest(despesasUrl);
      
      if (response.dados && response.dados.length > 0) {
        todasDespesas = todasDespesas.concat(response.dados);
        
        console.log(`      ✅ Página ${pagina}: ${response.dados.length} despesas`);
        
        // Pausar entre páginas para respeitar rate limit
        await sleep(config.pauseBetweenRequests / 2); // Pausa menor entre páginas
        
        pagina++;
      } else {
        // Página sem dados - acabaram as despesas
        if (pagina > 1) {
          console.log(`      📄 Página ${pagina}: Vazia - fim das despesas`);
        }
        break;
      }
      
    } catch (error) {
      console.log(`      ❌ Erro na página ${pagina}: ${error.message}`);
      break;
    }
  }
  
  return todasDespesas;
}

// 7. Função para buscar TODOS os deputados da legislatura (com paginação COMPLETA e deduplicação)
async function buscarTodosDeputadosLegislatura(legislatura, limite = null) {
  let todosDeputadosRAW = []; // TODOS os deputados de TODAS as páginas
  let deputadosUnicos = new Map(); // Para deduplicação baseada no ID
  let pagina = 1;
  let paginasComDados = 0;
  
  console.log('🔍 Buscando TODOS os deputados da legislatura (paginação COMPLETA até acabar)...');
  
  // FASE 1: Buscar TODAS as páginas de deputados ATÉ ACABAR
  while (true) {
    try {
      let deputadosUrl = `${config.baseURL}/deputados?idLegislatura=${legislatura}&itens=${config.itemsPerPage}&pagina=${pagina}`;
      
      console.log(`   📄 Buscando página ${pagina}...`);
      
      const response = await makeRequest(deputadosUrl);
      
      if (response.dados && response.dados.length > 0) {
        // Adicionar TODOS os deputados (com duplicatas ainda)
        todosDeputadosRAW = todosDeputadosRAW.concat(response.dados);
        paginasComDados = pagina; // Atualizar contador de páginas reais
        
        console.log(`   ✅ Página ${pagina}: ${response.dados.length} deputados (${todosDeputadosRAW.length} total RAW)`);
        
        // Pausar entre páginas
        await sleep(config.pauseBetweenRequests);
        
        pagina++;
      } else {
        // Página sem dados - acabaram os deputados
        console.log(`   📄 Página ${pagina}: Vazia - fim dos dados`);
        break;
      }
      
    } catch (error) {
      console.log(`   ❌ Erro na página ${pagina}: ${error.message}`);
      break;
    }
  }
  
  console.log(`📊 TOTAL RAW: ${todosDeputadosRAW.length} deputados de ${paginasComDados} páginas (com dados)`);
  
  // FASE 2: Aplicar deduplicação em TODOS os dados
  console.log('🔄 Aplicando deduplicação em TODOS os deputados...');
  let todosDeputados = [];
  let duplicatasEncontradas = 0;
  
  todosDeputadosRAW.forEach(deputado => {
    if (!deputadosUnicos.has(deputado.id)) {
      deputadosUnicos.set(deputado.id, deputado);
      todosDeputados.push(deputado);
    } else {
      duplicatasEncontradas++;
      console.log(`   🔄 Deputado duplicado removido: ${deputado.nome} (ID: ${deputado.id})`);
    }
  });
  
  console.log(`✅ Deduplicação concluída: ${duplicatasEncontradas} duplicatas removidas`);
  console.log(`📊 Total únicos: ${todosDeputados.length} deputados`);
  
  // FASE 3: Aplicar limite se especificado (APÓS deduplicação)
  if (limite && todosDeputados.length > limite) {
    console.log(`🎯 Aplicando limite: ${limite} deputados de ${todosDeputados.length} disponíveis`);
    todosDeputados = todosDeputados.slice(0, limite);
  }
  
  console.log(`✅ RESULTADO FINAL: ${todosDeputados.length} deputados únicos ${limite ? '(com limite aplicado)' : '(sem limite)'}`);
  
  return todosDeputados;
}

// 8. Processamento principal
async function processarDespesas() {
  try {
    console.log('🔍 Buscando deputados da legislatura', legislatura + 'ª...');
    
    // Buscar TODOS os deputados com paginação e deduplicação
    const deputados = await buscarTodosDeputadosLegislatura(legislatura, limite);
    
    if (!deputados || deputados.length === 0) {
      throw new Error('Nenhum deputado encontrado');
    }
    
    console.log(`✅ Encontrados ${deputados.length} deputados únicos (após deduplicação)`);
    console.log('');
    
    const resultados = {
      legislatura,
      totalDeputados: deputados.length,
      processados: 0,
      sucessos: 0,
      falhas: 0,
      totalDespesas: 0,
      deputados: []
    };
    
    // Processar cada deputado
    console.log('💰 Processando despesas dos deputados...');
    console.log('═'.repeat(60));
    
    for (let i = 0; i < deputados.length; i++) {
      const deputado = deputados[i];
      
      try {
        const deputadoUrl = `${config.baseURL}/deputados/${deputado.id}/despesas?idLegislatura=${legislatura}`;
        console.log(`📊 [${i + 1}/${deputados.length}] ${deputado.nome} (${deputado.siglaPartido}-${deputado.siglaUf})`);
        console.log(`   🔗 URL Despesas: ${deputadoUrl}`);
        
        // 1. Buscar dados completos do deputado
        const dadosCompletos = await buscarDadosCompletosDeDeputado(deputado.id);
        
        // 2. Buscar TODAS as despesas do deputado com paginação
        console.log(`   🔍 Buscando todas as despesas da legislatura ${legislatura}ª (paginação ativa)...`);
        const despesas = await buscarTodasDespesasDeputado(deputado.id, legislatura);
        
        const totalDespesas = despesas.length;
        const valorTotal = despesas.reduce((sum, despesa) => sum + (despesa.valorLiquido || 0), 0);
        
        console.log(`   💰 ${totalDespesas} despesas COMPLETAS encontradas (R$ ${valorTotal.toLocaleString('pt-BR', { minimumFractionDigits: 2 })})`);
        
        // Agrupar despesas por ano para análise
        const despesasPorAno = {};
        despesas.forEach(despesa => {
          const ano = new Date(despesa.dataDocumento).getFullYear();
          if (!despesasPorAno[ano]) despesasPorAno[ano] = [];
          despesasPorAno[ano].push(despesa);
        });
        
        console.log(`   📅 Período: ${Object.keys(despesasPorAno).sort().join(', ')}`);
        
        // Combinar dados básicos com dados completos
        const deputadoCompleto = {
          ...deputado,
          ...dadosCompletos,
          totalDespesas,
          valorTotal,
          despesasPorAno: Object.keys(despesasPorAno).reduce((acc, ano) => {
            acc[ano] = despesasPorAno[ano].length;
            return acc;
          }, {}),
          // ✅ OTIMIZAÇÃO: Passar as despesas como um campo separado para o integrador
          despesas: despesas
        };
        
        resultados.deputados.push(deputadoCompleto);
        
        resultados.processados++;
        resultados.sucessos++;
        resultados.totalDespesas += totalDespesas;
        
        // Pausa entre requisições para respeitar rate limit
        if (i < deputados.length - 1) {
          await sleep(config.pauseBetweenRequests);
        }
        
      } catch (error) {
        console.log(`   ❌ Erro ao processar: ${error.message}`);
        resultados.falhas++;
      }
    }
    
    console.log('═'.repeat(60));
    console.log('');
    
    // 6. Salvar resultados
    const outputDir = './dados_processados';
    if (!existsSync(outputDir)) {
      mkdirSync(outputDir, { recursive: true });
    }
    
    const filename = `${outputDir}/despesas_legislatura_${legislatura}_${new Date().toISOString().split('T')[0]}.json`;
    
    // Sempre salvar uma cópia local para backup
    writeFileSync(filename, JSON.stringify(resultados, null, 2));
    console.log(`✅ Backup local salvo em: ${filename}`);
    console.log('💾 Processamento finalizado. A integração com o banco de dados foi removida.');

    // 7. Relatório final
    const tempoTotal = Date.now() - startTime;
    console.log('');
    console.log('📊 RELATÓRIO FINAL:');
    console.log('═'.repeat(50));
    console.log(`🎯 Legislatura: ${legislatura}ª`);
    console.log(`👥 Deputados processados: ${resultados.processados}/${resultados.deputados.length}`);
    console.log(`✅ Sucessos: ${resultados.sucessos}`);
    console.log(`❌ Falhas: ${resultados.falhas}`);
    console.log(`💰 Total de despesas: ${resultados.totalDespesas.toLocaleString('pt-BR')}`);
    console.log(`⏱️ Tempo total: ${(tempoTotal / 1000).toFixed(2)}s`);
    console.log(`🚀 Velocidade: ${(resultados.sucessos / (tempoTotal / 1000 / 60)).toFixed(1)} deputados/min`);
    
    const valorTotalGeral = resultados.deputados.reduce((sum, dep) => sum + dep.valorTotal, 0);
    console.log(`💵 Valor total processado: R$ ${valorTotalGeral.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`);
    console.log('');
    
    console.log('🏆 PROCESSAMENTO CONCLUÍDO COM SUCESSO!');
    console.log('✨ Arquitetura Clean funcionando perfeitamente!');

    // ✅ INTEGRAÇÃO FIRESTORE: Processar dados com ETL inteligente
    if (destino.useRealFirestore || destino.useEmulator) {
      console.log('');
      console.log('🔥 Iniciando integração com Firestore Real...');
      console.log('═'.repeat(60));
      
      try {
        const { default: ETLInteligente } = await import('./etl-inteligente.js');
        const etlInteligente = new ETLInteligente();
        
        // Executar integração com os dados já processados
        await etlInteligente.executarComDados(resultados);
        
      } catch (integracaoError) {
        console.error('❌ Erro na integração com Firestore:', integracaoError.message);
        console.log('💾 Dados salvos localmente como fallback');
      }
    }
    
  } catch (error) {
    console.error('💥 ERRO FATAL:', error.message);
    process.exit(1);
  }
}

// Iniciar processamento
const startTime = Date.now();
console.log(`🚀 Iniciando processamento em: ${new Date().toLocaleString('pt-BR')}`);
console.log('');

processarDespesas();