/**
 * Configuração de endpoints da API da Câmara dos Deputados
 *
 * Centraliza todas as URLs e configurações de endpoints
 * da API de Dados Abertos da Câmara dos Deputados.
 */

/**
 * Configuração de endpoint
 */
interface EndpointConfig {
  PATH: string;
  PARAMS: Record<string, any>;
  TIMEOUT?: number;
  RETRY_ATTEMPTS?: number;
  RETRY_DELAY?: number;
  dataInicio?: string;
  dataFim?: string;
}

/**
 * Configurações globais de request
 */
export const REQUEST_CONFIG = {
  RETRY_ATTEMPTS: 3,
  RETRY_DELAY: 1000,
  DEFAULT_TIMEOUT: 30000,
  DEFAULT_ITEMS_PER_PAGE: 100
};

/**
 * Base URL da API (será sobrescrita pela configuração de ambiente)
 */
export const BASE_URL = 'https://dadosabertos.camara.leg.br/api/v2';

/**
 * Endpoints organizados por categoria
 */
export const endpoints = {
  // Configurações globais
  REQUEST: REQUEST_CONFIG,
  BASE_URL,

  // Endpoints de Deputados
  DEPUTADOS: {
    // Lista de deputados por legislatura
    LISTA: {
      PATH: '/deputados',
      PARAMS: {
        idLegislatura: '',
        nome: '',
        siglaPartido: '',
        siglaUf: '',
        ordem: 'ASC',
        ordenarPor: 'nome',
        pagina: '1',
        itens: '100'
      },
      TIMEOUT: 15000
    } as EndpointConfig,

    // Perfil de deputado específico
    PERFIL: {
      PATH: '/deputados/{codigo}',
      PARAMS: {},
      TIMEOUT: 15000
    } as EndpointConfig,

    // Despesas de deputado
    DESPESAS: {
      PATH: '/deputados/{codigo}/despesas',
      PARAMS: {
        idLegislatura: '',
        ano: '',
        mes: '',
        cnpjCpfFornecedor: '',
        pagina: '1',
        itens: 100,
        ordem: 'ASC',
        ordenarPor: 'numDocumento'
      },
      TIMEOUT: 45000
    } as EndpointConfig,

    // Discursos de deputado
    DISCURSOS: {
      PATH: '/deputados/{codigo}/discursos',
      PARAMS: {
        idLegislatura: '',
        ordenarPor: 'dataHoraInicio',
        ordem: 'DESC',
        pagina: '1',
        itens: 100
      },
      TIMEOUT: 30000
    } as EndpointConfig,

    // Eventos de deputado
    EVENTOS: {
      PATH: '/deputados/{codigo}/eventos',
      PARAMS: {
        // idLegislatura: '', // Removido conforme feedback - API não suporta
        dataInicio: '',
        dataFim: '',
        pagina: '1',
        itens: 100,
        ordem: 'ASC', // Adicionado com base no exemplo da documentação/uso
        ordenarPor: 'dataHoraInicio' // Adicionado com base no exemplo da documentação/uso
      },
      TIMEOUT: 20000
    } as EndpointConfig,

    // Órgãos de deputado
    ORGAOS: {
      PATH: '/deputados/{codigo}/orgaos',
      PARAMS: {},
      TIMEOUT: 10000
    } as EndpointConfig,

    // Frentes parlamentares
    FRENTES: {
      PATH: '/deputados/{codigo}/frentes',
      PARAMS: {},
      TIMEOUT: 10000
    } as EndpointConfig,

    // Mandatos externos
    MANDATOS_EXTERNOS: {
      PATH: '/deputados/{codigo}/mandatosExternos',
      PARAMS: {},
      TIMEOUT: 10000
    } as EndpointConfig,

    // Histórico do deputado
    HISTORICO: {
      PATH: '/deputados/{codigo}/historico',
      PARAMS: {},
      TIMEOUT: 10000
    } as EndpointConfig,

    // Profissões do deputado
    PROFISSOES: {
      PATH: '/deputados/{codigo}/profissoes',
      PARAMS: {},
      TIMEOUT: 10000
    } as EndpointConfig,

    // Ocupações de deputado
    OCUPACOES: {
      PATH: '/deputados/{codigo}/ocupacoes',
      PARAMS: {},
      TIMEOUT: 10000
    } as EndpointConfig
  },

  // Endpoints de Órgãos (geral, não apenas comissões)
  ORGAOS: {
    // Lista de todos os órgãos
    LISTA: {
      PATH: '/orgaos',
      PARAMS: {
        // idLegislatura: '', // A API de órgãos não parece ter filtro por legislatura na listagem geral
        // idTipoOrgao: '', // Pode ser usado para filtrar por tipo
        // sigla: '',
        // dataInicio: '',
        // dataFim: '',
        ordem: 'ASC',
        ordenarPor: 'sigla', // ou 'nome', 'id'
        pagina: '1',
        itens: 100 // Máximo por página
      },
      TIMEOUT: 20000
    } as EndpointConfig,

    // Detalhes de um órgão específico
    DETALHES: {
      PATH: '/orgaos/{id}', // O placeholder é {id}
      PARAMS: {},
      TIMEOUT: 15000
    } as EndpointConfig,

    // Eventos de um órgão específico
    EVENTOS: {
      PATH: '/orgaos/{id}/eventos',
      PARAMS: {
        dataInicio: '', // Formato YYYY-MM-DD
        dataFim: '',    // Formato YYYY-MM-DD
        // idSituacao: '',
        // idTipoEvento: '',
        ordem: 'ASC',
        ordenarPor: 'dataHoraInicio',
        pagina: '1',
        itens: 100
      },
      TIMEOUT: 25000
    } as EndpointConfig,

    // Membros de um órgão específico
    MEMBROS: {
      PATH: '/orgaos/{id}/membros',
      PARAMS: {
        // dataInicio: '', // A API de membros de órgão não parece ter filtro de data
        // dataFim: '',
        // idPapel: '', // Filtrar por papel/cargo
        pagina: '1',
        itens: 100
      },
      TIMEOUT: 20000
    } as EndpointConfig,

    // Votações de um órgão específico
    VOTACOES: {
      PATH: '/orgaos/{id}/votacoes',
      PARAMS: {
        dataInicio: '', // Formato YYYY-MM-DD
        dataFim: '',    // Formato YYYY-MM-DD
        // idProposicao: '',
        ordem: 'DESC',
        ordenarPor: 'dataHoraRegistro',
        pagina: '1',
        itens: 100
      },
      TIMEOUT: 30000
    } as EndpointConfig
  },

  // Endpoints de Proposições/Matérias
  PROPOSICOES: {
    // Lista de proposições
    LISTA: {
      PATH: '/proposicoes',
      PARAMS: {
        idLegislatura: '',
        siglaTipo: '',
        numero: '',
        ano: '',
        dataInicio: '',
        dataFim: '',
        dataApresentacaoInicio: '',
        dataApresentacaoFim: '',
        idDeputadoAutor: '',
        autor: '',
        siglaPartidoAutor: '',
        siglaUfAutor: '',
        keywords: '',
        tramitacaoSenado: '',
        ordem: 'ASC',
        ordenarPor: 'id',
        pagina: '1',
        itens: 100
      },
      TIMEOUT: 30000
    } as EndpointConfig,

    // Proposição específica
    DETALHES: {
      PATH: '/proposicoes/{codigo}',
      PARAMS: {},
      TIMEOUT: 15000
    } as EndpointConfig,

    // Autores de proposição
    AUTORES: {
      PATH: '/proposicoes/{codigo}/autores',
      PARAMS: {},
      TIMEOUT: 10000
    } as EndpointConfig,

    // Relatores de proposição
    RELATORES: {
      PATH: '/proposicoes/{codigo}/relatores',
      PARAMS: {},
      TIMEOUT: 10000
    } as EndpointConfig,

    // Tramitações
    TRAMITACOES: {
      PATH: '/proposicoes/{codigo}/tramitacoes',
      PARAMS: {
        dataInicio: '',
        dataFim: '',
        pagina: '1',
        itens: 100
      },
      TIMEOUT: 20000
    } as EndpointConfig,

    // Votações
    VOTACOES: {
      PATH: '/proposicoes/{codigo}/votacoes',
      PARAMS: {
        pagina: '1',
        itens: 100
      },
      TIMEOUT: 25000
    } as EndpointConfig
  },

  // Endpoints de Votações
  VOTACOES: {
    // Lista de votações
    LISTA: {
      PATH: '/votacoes',
      PARAMS: {
        idLegislatura: '',
        dataInicio: '',
        dataFim: '',
        idProposicao: '',
        ordem: 'DESC',
        ordenarPor: 'dataHoraRegistro',
        pagina: '1',
        itens: 100
      },
      TIMEOUT: 60000
    } as EndpointConfig,

    // Votação específica
    DETALHES: {
      PATH: '/votacoes/{codigo}',
      PARAMS: {},
      TIMEOUT: 30000
    } as EndpointConfig,

    // Votos de uma votação
    VOTOS: {
      PATH: '/votacoes/{codigo}/votos',
      PARAMS: {
        pagina: '1',
        itens: 100
      },
      TIMEOUT: 45000
    } as EndpointConfig,

    // Orientações de bancada
    ORIENTACOES: {
      PATH: '/votacoes/{codigo}/orientacoes',
      PARAMS: {},
      TIMEOUT: 15000
    } as EndpointConfig
  },

  // Endpoints de Comissões
  COMISSOES: {
    // Lista de comissões
    LISTA: {
      PATH: '/orgaos',
      PARAMS: {
        idLegislatura: '',
        idTipoOrgao: '',
        sigla: '',
        dataInicio: '',
        dataFim: '',
        ordem: 'ASC',
        ordenarPor: 'sigla',
        pagina: '1',
        itens: 100
      },
      TIMEOUT: 20000
    } as EndpointConfig,

    // Comissão específica
    DETALHES: {
      PATH: '/orgaos/{codigo}',
      PARAMS: {},
      TIMEOUT: 15000
    } as EndpointConfig,

    // Membros de comissão
    MEMBROS: {
      PATH: '/orgaos/{codigo}/membros',
      PARAMS: {
        dataInicio: '',
        dataFim: '',
        pagina: '1',
        itens: 100
      },
      TIMEOUT: 20000
    } as EndpointConfig,

    // Eventos de comissão
    EVENTOS: {
      PATH: '/orgaos/{codigo}/eventos',
      PARAMS: {
        dataInicio: '',
        dataFim: '',
        pagina: '1',
        itens: 100
      },
      TIMEOUT: 25000
    } as EndpointConfig,

    // Votações de comissão
    VOTACOES: {
      PATH: '/orgaos/{codigo}/votacoes',
      PARAMS: {
        dataInicio: '',
        dataFim: '',
        pagina: '1',
        itens: 100
      },
      TIMEOUT: 30000
    } as EndpointConfig
  },

  // Endpoints de Eventos
  EVENTOS: {
    // Lista de eventos
    LISTA: {
      PATH: '/eventos',
      PARAMS: {
        idLegislatura: '',
        idTipoEvento: '',
        idSituacao: '',
        idOrgao: '',
        dataInicio: '',
        dataFim: '',
        horaInicio: '',
        horaFim: '',
        ordem: 'DESC',
        ordenarPor: 'dataHoraInicio',
        pagina: '1',
        itens: 100
      },
      TIMEOUT: 25000
    } as EndpointConfig,

    // Evento específico
    DETALHES: {
      PATH: '/eventos/{codigo}',
      PARAMS: {},
      TIMEOUT: 15000
    } as EndpointConfig,

    // Deputados presentes no evento
    DEPUTADOS: {
      PATH: '/eventos/{codigo}/deputados',
      PARAMS: {
        pagina: 1,
        itens: 100
      },
      TIMEOUT: 20000
    } as EndpointConfig,

    // Pauta do evento
    PAUTA: {
      PATH: '/eventos/{codigo}/pauta',
      PARAMS: {},
      TIMEOUT: 15000
    } as EndpointConfig
  },

  // Endpoints de Legislaturas
  LEGISLATURAS: {
    // Lista de legislaturas
    LISTA: {
      PATH: '/legislaturas',
      PARAMS: {
        ordem: 'DESC',
        ordenarPor: 'id'
        // pagina e itens removidos conforme feedback
      },
      TIMEOUT: 10000
    } as EndpointConfig,

    // Legislatura específica
    DETALHES: {
      PATH: '/legislaturas/{id}',
      PARAMS: {},
      TIMEOUT: 10000
    } as EndpointConfig,

    // Líderes da legislatura
    LIDERES: {
      PATH: '/legislaturas/{id}/lideres',
      PARAMS: {
        // A API não especifica parâmetros obrigatórios aqui.
        // Poderia adicionar paginação se aplicável, mas a tarefa não menciona.
        // itens: '100',
        // pagina: '1'
      },
      TIMEOUT: 15000
    } as EndpointConfig,

    // Mesa diretora da legislatura
    MESA: {
      PATH: '/legislaturas/{id}/mesa',
      PARAMS: {
        // Nenhum parâmetro conforme feedback
      },
      TIMEOUT: 15000
    } as EndpointConfig
  },

  // Endpoints de Partidos
  PARTIDOS: {
    // Lista de partidos
    LISTA: {
      PATH: '/partidos',
      PARAMS: {
        idLegislatura: '',
        dataInicio: '',
        dataFim: '',
        ordem: 'ASC',
        ordenarPor: 'sigla',
        pagina: 1,
        itens: 100
      },
      TIMEOUT: 15000
    } as EndpointConfig,

    // Partido específico
    DETALHES: {
      PATH: '/partidos/{codigo}',
      PARAMS: {},
      TIMEOUT: 10000
    } as EndpointConfig,

    // Líderes do partido (NOVO)
    LIDERES: {
      PATH: '/partidos/{codigo}/lideres',
      PARAMS: {}, // Sem parâmetros adicionais conforme a descrição da tarefa
      TIMEOUT: 15000
    } as EndpointConfig,

    // Membros do partido
    MEMBROS: {
      PATH: '/partidos/{codigo}/membros',
      PARAMS: {
        idLegislatura: '' // Apenas idLegislatura é necessário
      },
      TIMEOUT: 20000
    } as EndpointConfig
  },

  // Endpoints de Blocos Parlamentares
  BLOCOS: {
    // Lista de blocos
    LISTA: {
      PATH: '/blocos',
      PARAMS: {
        idLegislatura: '',
        ordem: 'ASC',
        ordenarPor: 'nome',
        pagina: 1,
        itens: 100
      },
      TIMEOUT: 15000
    } as EndpointConfig,

    // Bloco específico
    DETALHES: {
      PATH: '/blocos/{codigo}',
      PARAMS: {},
      TIMEOUT: 10000
    } as EndpointConfig,

    // Partidos de um bloco
    PARTIDOS: {
      PATH: '/blocos/{codigo}/partidos',
      PARAMS: {}, // Este endpoint não aceita paginação
      TIMEOUT: 10000
    } as EndpointConfig
  },

  // Endpoints de Grupos Parlamentares
  GRUPOS: {
    // Lista de grupos
    LISTA: {
      PATH: '/grupos',
      PARAMS: {
        pagina: 1,
        itens: 100 // Default da API, mas pode ser alterado
        // 'ordem' e 'ordenarPor' removidos pois não são suportados por este endpoint
      },
      TIMEOUT: 15000
    } as EndpointConfig,

    // Grupo específico
    DETALHES: {
      PATH: '/grupos/{id}',
      PARAMS: {},
      TIMEOUT: 10000
    } as EndpointConfig,

    // Histórico de um grupo
    HISTORICO: {
      PATH: '/grupos/{id}/historico',
      PARAMS: {
        // Este endpoint não aceita parâmetros de paginação
      },
      TIMEOUT: 15000
    } as EndpointConfig,

    // Membros de um grupo
    MEMBROS: {
      PATH: '/grupos/{id}/membros',
      PARAMS: {
        // Este endpoint não aceita parâmetros de paginação
      },
      TIMEOUT: 20000
    } as EndpointConfig
  },

  // Endpoints de Lideranças
  LIDERANCAS: {
    // Lista de lideranças
    LISTA: {
      PATH: '/liderancas',
      PARAMS: {
        idLegislatura: '',
        dataInicio: '',
        dataFim: '',
        pagina: 1,
        itens: 100
      },
      TIMEOUT: 15000
    } as EndpointConfig,

    // Liderança específica
    DETALHES: {
      PATH: '/liderancas/{codigo}',
      PARAMS: {},
      TIMEOUT: 10000
    } as EndpointConfig
  },

  // Endpoints de Frentes Parlamentares
  FRENTES: {
    // Lista de frentes
    LISTA: {
      PATH: '/frentes',
      PARAMS: {
        idLegislatura: '',
        ordem: 'ASC',
        ordenarPor: 'titulo',
        pagina: 1,
        itens: 100
      },
      TIMEOUT: 20000
    } as EndpointConfig,

    // Frente específica
    DETALHES: {
      PATH: '/frentes/{codigo}',
      PARAMS: {},
      TIMEOUT: 15000
    } as EndpointConfig,

    // Membros de frente
    MEMBROS: {
      PATH: '/frentes/{codigo}/membros',
      PARAMS: {
        pagina: 1,
        itens: 100
      },
      TIMEOUT: 20000
    } as EndpointConfig
  },

  // Endpoints de Referências (dados auxiliares)
  REFERENCIAS: {
    // Situações de proposições
    SITUACOES_PROPOSICAO: {
      PATH: '/referencias/situacoesProposicao',
      PARAMS: {},
      TIMEOUT: 10000
    } as EndpointConfig,

    // Tipos de proposição
    TIPOS_PROPOSICAO: {
      PATH: '/referencias/tiposProposicao',
      PARAMS: {},
      TIMEOUT: 10000
    } as EndpointConfig,

    // Tipos de evento
    TIPOS_EVENTO: {
      PATH: '/referencias/tiposEvento',
      PARAMS: {},
      TIMEOUT: 10000
    } as EndpointConfig,

    // Tipos de órgão
    TIPOS_ORGAO: {
      PATH: '/referencias/tiposOrgao',
      PARAMS: {},
      TIMEOUT: 10000
    } as EndpointConfig,

    // UFs
    UFS: {
      PATH: '/referencias/uf',
      PARAMS: {},
      TIMEOUT: 10000
    } as EndpointConfig,

    // Partidos
    PARTIDOS: {
      PATH: '/referencias/partidos',
      PARAMS: {},
      TIMEOUT: 10000
    } as EndpointConfig,

    // Situações de deputado
    SITUACOES_DEPUTADO: {
      PATH: '/referencias/situacoesDeputado',
      PARAMS: {},
      TIMEOUT: 10000
    } as EndpointConfig
  }
};
