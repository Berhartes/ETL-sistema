/**
 * Transformador especializado para perfis de deputados
 * Este módulo transforma especificamente perfis completos de deputados,
 * tratando as peculiaridades da resposta da API da Câmara dos Deputados.
 */
import { logger } from '../utils/logging/logger.js';
import { DeputadosLegislaturaResult, PerfilCompletoResult } from '../extracao/perfildeputados.js';

// Interface para Deputado básico transformado
export interface DeputadoBasicoTransformado {
  codigo: string;
  nome: string;
  nomeCompleto: string;
  genero: string;
  partido: {
    sigla: string;
    nome: string | null;
  };
  uf: string;
  foto: string;
  email: string;
  situacao: {
    emExercicio: boolean;
    afastado: boolean;
  };
  legislaturaAtual?: {
    codigo: string;
    legislatura: string;
  } | null;
  atualizadoEm: string;
}

// Interface para Deputado completo transformado
export interface DeputadoCompletoTransformado extends DeputadoBasicoTransformado {
  // Campo opcional para mensagens de erro
  erro?: string;
  
  // Dados pessoais expandidos
  dadosPessoais: {
    nomeCivil: string;
    cpf: string;
    sexo: string; // M ou F
    dataNascimento: string | null;
    dataFalecimento: string | null;
    naturalidade: string;
    ufNaturalidade: string;
    escolaridade: string;
    urlWebsite: string;
    redeSocial: string;
  };
  
  // Status parlamentar atual
  ultimoStatus: {
    id: string;
    nome: string;
    nomeEleitoral: string;
    siglaPartido: string;
    uriPartido: string;
    siglaUf: string;
    idLegislatura: string;
    situacao: string; // Ex: "Exercício", "Vacância", etc.
    condicaoEleitoral: string; // Ex: "Titular", "Suplente"
    descricaoStatus: string;
    data: string; // Data do último status
  };
  
  // Informações do gabinete
  gabinete: {
    nome: string;
    predio: string;
    sala: string;
    andar: string;
    telefone: string;
    email: string;
  };
  
  // Arrays de dados complementares (interfaces expandidas para capturar todos os dados)
  orgaos?: Array<{
    codigo: string;
    uri: string;
    sigla: string;
    nome: string;
    nomePublicacao: string;
    cargo: string;
    codTitulo: string;
    dataInicio?: string;
    dataFim?: string | null;
    atual: boolean;
  }>;
  frentes?: Array<{
    codigo: string;
    uri: string;
    titulo: string;
    idLegislatura: string;
  }>;
  ocupacoes?: Array<{
    titulo: string;
    entidade: string;
    entidadeUF: string;
    entidadePais: string;
    anoInicio: string;
    anoFim: string;
  }>;
  mandatosExternos?: Array<{
    cargo: string;
    siglaUf: string;
    municipio: string;
    anoInicio: string;
    anoFim: string;
    siglaPartidoEleicao: string;
    uriPartidoEleicao?: string;
  }>;
  historico?: Array<{
    id: string;
    uri: string;
    nome: string;
    nomeEleitoral: string;
    siglaPartido: string;
    uriPartido: string;
    siglaUf: string;
    idLegislatura: string;
    email: string;
    urlFoto: string;
    dataHora: string;
    situacao: string;
    condicaoEleitoral: string;
    descricaoStatus: string;
  }>;
  profissoes?: Array<{
    titulo: string;
    codTipoProfissao: string;
    dataHora: string;
  }>;
  
  // Situação atual (derivada do ultimoStatus)
  situacaoAtual: {
    emExercicio: boolean;
    afastado: boolean;
    motivoAfastamento?: string | null;
    legislaturaAtual?: {
      codigo: string;
      legislatura: string;
    } | null;
  };
  
  // Metadados
  metadados: {
    atualizadoEm: string;
    fontes: {
      [key: string]: string;
    };
    statusDados?: string;
  };
}

// Interface para resultado da transformação de lista de deputados
export interface ResultadoTransformacaoLista {
  timestamp: string;
  deputados: DeputadoBasicoTransformado[];
  legislatura: number;
}

/**
 * Classe para transformação de dados de perfis de deputados
 */
export class PerfilDeputadosTransformer {
  /**
   * Transforma os dados brutos de deputados de uma legislatura específica
   * @param extractionResult - Resultado da extração
   * @param legislaturaNumero - Número da legislatura (opcional)
   */
  transformDeputadosLegislatura(extractionResult: DeputadosLegislaturaResult, legislaturaNumero?: number): ResultadoTransformacaoLista {
    logger.info('Transformando dados de deputados de legislatura específica');

    const { deputados } = extractionResult;

    if (!deputados || !Array.isArray(deputados) || deputados.length === 0) {
      logger.warn('Dados de deputados inválidos ou vazios para transformação');
      return {
        timestamp: new Date().toISOString(),
        deputados: [],
        legislatura: 0
      };
    }

    // Extrair número da legislatura do metadata (se disponível) ou usar o parâmetro
    let legislatura = legislaturaNumero || 0;
    if (!legislatura && deputados.length > 0 && deputados[0].idLegislatura) {
      // Tentar extrair do primeiro deputado
      legislatura = parseInt(deputados[0].idLegislatura, 10) || 0;
    }

    // Transformar cada deputado
    const deputadosTransformados = deputados.map(deputado => {
      try {
        return this.transformDeputadoBasico(deputado);
      } catch (error: any) {
        logger.warn(`Erro ao transformar deputado básico: ${error.message}`);
        // Retornar objeto mínimo se não for possível transformar
        return deputado && deputado.id ? {
          codigo: deputado.id.toString() || 'desconhecido',
          nome: deputado.nome || 'Nome não disponível',
          nomeCompleto: deputado.nome || 'Nome não disponível',
          genero: '',
          partido: {
            sigla: deputado.siglaPartido || '',
            nome: null
          },
          uf: deputado.siglaUf || '',
          foto: deputado.urlFoto || '',
          email: deputado.email || '',
          situacao: {
            emExercicio: true,
            afastado: false
          },
          atualizadoEm: new Date().toISOString()
        } : null;
      }
    }).filter(Boolean) as DeputadoBasicoTransformado[]; // Remove itens nulos

    logger.info(`Transformados ${deputadosTransformados.length} deputados da legislatura ${legislatura}`);

    return {
      timestamp: new Date().toISOString(),
      deputados: deputadosTransformados,
      legislatura
    };
  }

  /**
   * Transforma dados básicos de um deputado
   * @param deputado - Dados básicos do deputado
   */
  transformDeputadoBasico(deputado: any): DeputadoBasicoTransformado | null {
    // Verificar se temos dados válidos
    if (!deputado || !deputado.id) {
      logger.warn('Dados incompletos de deputado para transformação básica');
      return null;
    }

    // Determinar gênero a partir do campo sexo (se disponível)
    let genero = '';
    if (deputado.sexo) {
      genero = deputado.sexo === 'M' ? 'Masculino' : deputado.sexo === 'F' ? 'Feminino' : '';
    }

    // Extrair informações do último status se disponível
    const ultimoStatus = deputado.ultimoStatus || {};
    const siglaPartido = ultimoStatus.siglaPartido || deputado.siglaPartido || '';
    const siglaUf = ultimoStatus.siglaUf || deputado.siglaUf || '';
    const email = ultimoStatus.gabinete?.email || deputado.email || '';
    const urlFoto = ultimoStatus.urlFoto || deputado.urlFoto || '';
    const nome = ultimoStatus.nome || deputado.nome || '';
    const idLegislatura = ultimoStatus.idLegislatura || deputado.idLegislatura;

    // Extrair dados principais
    const deputadoTransformado: DeputadoBasicoTransformado = {
      codigo: deputado.id.toString(),
      nome: nome,
      nomeCompleto: deputado.nomeCivil || nome,
      genero: genero,
      foto: urlFoto,
      email: email,
      partido: {
        sigla: siglaPartido,
        nome: null // Será preenchido com dados detalhados posteriormente se necessário
      },
      uf: siglaUf,
      situacao: {
        emExercicio: ultimoStatus.situacao ? ultimoStatus.situacao.toLowerCase().includes('exerc') : true,
        afastado: ultimoStatus.situacao ? ultimoStatus.situacao.toLowerCase().includes('afastado') : false
      },
      legislaturaAtual: idLegislatura ? {
        codigo: deputado.id.toString(),
        legislatura: idLegislatura.toString()
      } : null,
      atualizadoEm: new Date().toISOString()
    };

    return deputadoTransformado;
  }

  /**
   * Transforma o perfil completo de um deputado
   * @param perfilCompleto - Perfil completo extraído
   */
  transformPerfilCompleto(perfilCompleto: PerfilCompletoResult): DeputadoCompletoTransformado | null {
    try {
      // Verificação se o perfil existe
      if (!perfilCompleto) {
        logger.error(`Perfil completo é nulo ou indefinido`);
        return null;
      }

      // Verificação para dados básicos
      if (!perfilCompleto.dadosBasicos ||
          !perfilCompleto.dadosBasicos.dados ||
          Object.keys(perfilCompleto.dadosBasicos.dados).length === 0) {
        logger.warn(`Dados básicos incompletos ou vazios para o deputado ${perfilCompleto.codigo || 'desconhecido'}`);

        // Retornar objeto mínimo para evitar falha total
        return {
          codigo: perfilCompleto.codigo?.toString() || 'desconhecido',
          nome: 'Dados indisponíveis',
          nomeCompleto: 'Dados indisponíveis',
          genero: '',
          partido: { sigla: '', nome: null },
          uf: '',
          foto: '',
          email: '',
          situacao: {
            emExercicio: false,
            afastado: false
          },
          dadosPessoais: {
            nomeCivil: '',
            cpf: '',
            sexo: '',
            dataNascimento: null,
            dataFalecimento: null,
            naturalidade: '',
            ufNaturalidade: '',
            escolaridade: '',
            urlWebsite: '',
            redeSocial: ''
          },
          ultimoStatus: {
            id: '',
            nome: '',
            nomeEleitoral: '',
            siglaPartido: '',
            uriPartido: '',
            siglaUf: '',
            idLegislatura: '',
            situacao: '',
            condicaoEleitoral: '',
            descricaoStatus: '',
            data: ''
          },
          gabinete: {
            nome: '',
            predio: '',
            sala: '',
            andar: '',
            telefone: '',
            email: ''
          },
          orgaos: [],
          frentes: [],
          ocupacoes: [],
          mandatosExternos: [],
          historico: [],
          profissoes: [],
          situacaoAtual: {
            emExercicio: false,
            afastado: false
          },
          metadados: {
            atualizadoEm: new Date().toISOString(),
            statusDados: 'incompleto',
            fontes: {}
          },
          atualizadoEm: new Date().toISOString()
        };
      }

      logger.info(`Transformando perfil completo do deputado ${perfilCompleto.codigo}`);

      // Extrair componentes principais do perfil
      const dadosBasicos = perfilCompleto.dadosBasicos.dados || {};
      const orgaos = perfilCompleto.orgaos?.dados || null;
      const frentes = perfilCompleto.frentes?.dados || null;
      const ocupacoes = perfilCompleto.ocupacoes?.dados || null;
      const mandatosExternos = perfilCompleto.mandatosExternos?.dados || null;
      const historico = perfilCompleto.historico?.dados || null;
      const profissoes = perfilCompleto.profissoes?.dados || null;

      // Transformar dados básicos
      const deputadoBasico = this.transformDeputadoBasico(dadosBasicos);

      if (!deputadoBasico) {
        logger.warn(`Não foi possível transformar os dados básicos do deputado ${perfilCompleto.codigo}`);
        return null;
      }

      // Transformar dados pessoais expandidos
      const dadosPessoais = {
        nomeCivil: dadosBasicos.nomeCivil || '',
        cpf: dadosBasicos.cpf || '',
        sexo: dadosBasicos.sexo || '',
        dataNascimento: dadosBasicos.dataNascimento || null,
        dataFalecimento: dadosBasicos.dataFalecimento || null,
        naturalidade: dadosBasicos.municipioNascimento || '',
        ufNaturalidade: dadosBasicos.ufNascimento || '',
        escolaridade: dadosBasicos.escolaridade || '',
        urlWebsite: dadosBasicos.urlWebsite || '',
        redeSocial: dadosBasicos.redeSocial || ''
      };

      // Transformar último status
      const ultimoStatus = dadosBasicos.ultimoStatus || {};
      const ultimoStatusTransformado = {
        id: ultimoStatus.id?.toString() || dadosBasicos.id?.toString() || '',
        nome: ultimoStatus.nome || dadosBasicos.nome || '',
        nomeEleitoral: ultimoStatus.nomeEleitoral || ultimoStatus.nome || dadosBasicos.nome || '',
        siglaPartido: ultimoStatus.siglaPartido || '',
        uriPartido: ultimoStatus.uriPartido || '',
        siglaUf: ultimoStatus.siglaUf || '',
        idLegislatura: ultimoStatus.idLegislatura?.toString() || '',
        situacao: ultimoStatus.situacao || '',
        condicaoEleitoral: ultimoStatus.condicaoEleitoral || '',
        descricaoStatus: ultimoStatus.descricaoStatus || '',
        data: ultimoStatus.data || ''
      };

      // Transformar informações do gabinete
      const gabinete = ultimoStatus.gabinete || {};
      const gabineteTransformado = {
        nome: gabinete.nome || '',
        predio: gabinete.predio || '',
        sala: gabinete.sala || '',
        andar: gabinete.andar || '',
        telefone: gabinete.telefone || '',
        email: gabinete.email || ''
      };

      // Transformar órgãos
      const orgaosTransformados = Array.isArray(orgaos) ? orgaos.map(orgao => ({
        codigo: orgao.idOrgao?.toString() || '',
        uri: orgao.uriOrgao || '',
        sigla: orgao.siglaOrgao || '',
        nome: orgao.nomeOrgao || '',
        nomePublicacao: orgao.nomePublicacao || '',
        cargo: orgao.titulo || '',
        codTitulo: orgao.codTitulo?.toString() || '',
        dataInicio: orgao.dataInicio || undefined,
        dataFim: orgao.dataFim || null,
        atual: !orgao.dataFim
      })) : [];

      // Transformar frentes
      const frentesTransformadas = Array.isArray(frentes) ? frentes.map(frente => ({
        codigo: frente.id?.toString() || '',
        uri: frente.uri || '',
        titulo: frente.titulo || '',
        idLegislatura: frente.idLegislatura?.toString() || ''
      })) : [];

      // Transformar ocupações
      const ocupacoesTransformadas = Array.isArray(ocupacoes) ? ocupacoes.map(ocupacao => ({
        titulo: ocupacao.titulo || '',
        entidade: ocupacao.entidade || '',
        entidadeUF: ocupacao.entidadeUF || '',
        entidadePais: ocupacao.entidadePais || '',
        anoInicio: ocupacao.anoInicio || '',
        anoFim: ocupacao.anoFim || ''
      })) : [];

      // Transformar mandatos externos
      const mandatosExternosTransformados = Array.isArray(mandatosExternos) ? mandatosExternos.map(mandato => ({
        cargo: mandato.cargo || '',
        siglaUf: mandato.siglaUf || '',
        municipio: mandato.municipio || '',
        anoInicio: mandato.anoInicio || '',
        anoFim: mandato.anoFim || '',
        siglaPartidoEleicao: mandato.siglaPartidoEleicao || '',
        uriPartidoEleicao: mandato.uriPartidoEleicao || ''
      })) : [];

      // Transformar histórico
      const historicoTransformado = Array.isArray(historico) ? historico.map(item => ({
        id: item.id?.toString() || '',
        uri: item.uri || '',
        nome: item.nome || '',
        nomeEleitoral: item.nomeEleitoral || '',
        siglaPartido: item.siglaPartido || '',
        uriPartido: item.uriPartido || '',
        siglaUf: item.siglaUf || '',
        idLegislatura: item.idLegislatura?.toString() || '',
        email: item.email || '',
        urlFoto: item.urlFoto || '',
        dataHora: item.dataHora || '',
        situacao: item.situacao || '',
        condicaoEleitoral: item.condicaoEleitoral || '',
        descricaoStatus: item.descricaoStatus || ''
      })) : [];

      // Transformar profissões
      const profissoesTransformadas = Array.isArray(profissoes) ? profissoes.map(profissao => ({
        titulo: profissao.titulo || '',
        codTipoProfissao: profissao.codTipoProfissao?.toString() || '',
        dataHora: profissao.dataHora || ''
      })) : [];

      // Construir objeto completo
      const deputadoCompleto: DeputadoCompletoTransformado = {
        ...deputadoBasico,
        dadosPessoais,
        ultimoStatus: ultimoStatusTransformado,
        gabinete: gabineteTransformado,
        orgaos: orgaosTransformados,
        frentes: frentesTransformadas,
        ocupacoes: ocupacoesTransformadas,
        mandatosExternos: mandatosExternosTransformados,
        historico: historicoTransformado,
        profissoes: profissoesTransformadas,
        situacaoAtual: {
          emExercicio: ultimoStatusTransformado.situacao ? 
            ultimoStatusTransformado.situacao.toLowerCase().includes('exerc') : 
            deputadoBasico.situacao.emExercicio,
          afastado: ultimoStatusTransformado.situacao ? 
            (ultimoStatusTransformado.situacao.toLowerCase().includes('afastado') || 
             ultimoStatusTransformado.situacao.toLowerCase().includes('vacância') ||
             ultimoStatusTransformado.situacao.toLowerCase().includes('licença')) : 
            deputadoBasico.situacao.afastado,
          motivoAfastamento: ultimoStatusTransformado.situacao && 
            !ultimoStatusTransformado.situacao.toLowerCase().includes('exerc') ? 
            ultimoStatusTransformado.situacao : null,
          legislaturaAtual: ultimoStatusTransformado.idLegislatura ? {
            codigo: deputadoBasico.codigo,
            legislatura: ultimoStatusTransformado.idLegislatura
          } : deputadoBasico.legislaturaAtual
        },
        metadados: {
          atualizadoEm: new Date().toISOString(),
          fontes: {
            dadosBasicos: perfilCompleto.dadosBasicos.origem || 'desconhecida',
            orgaos: perfilCompleto.orgaos?.origem || 'desconhecida',
            frentes: perfilCompleto.frentes?.origem || 'desconhecida',
            ocupacoes: perfilCompleto.ocupacoes?.origem || 'desconhecida',
            mandatosExternos: perfilCompleto.mandatosExternos?.origem || 'desconhecida',
            historico: perfilCompleto.historico?.origem || 'desconhecida',
            profissoes: perfilCompleto.profissoes?.origem || 'desconhecida'
          }
        }
      };

      return deputadoCompleto;
    } catch (error: any) {
      logger.error(`Erro ao transformar perfil completo do deputado ${perfilCompleto?.codigo || 'desconhecido'}: ${error.message}`);
      return null;
    }
  }
}
