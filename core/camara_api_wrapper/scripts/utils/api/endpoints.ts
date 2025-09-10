/**
 * Configuração centralizada dos endpoints da API do Senado
 */

export const endpoints = {
  BASE_URL: 'https://legis.senado.leg.br/dadosabertos',

  // Informações sobre Legislatura
  LEGISLATURA: {
    POR_DATA: {
      PATH: '/plenario/legislatura/{data}',
      PARAMS: { v: 3, format: 'json' }
    },
    LISTA: {
      PATH: '/plenario/lista/legislaturas',
      PARAMS: { v: 3, format: 'json' }
    }
  },

  // Blocos Parlamentares, Partidos, Mesas e Lideranças
  COMPOSICAO: {
    // Blocos Parlamentares
    BLOCOS: {
      LISTA: {
        PATH: '/composicao/lista/blocos',
        PARAMS: { v: 1, format: 'json' }
      },
      DETALHE: {
        PATH: '/composicao/bloco/{codigo}',
        PARAMS: { v: 1, format: 'json' }
      }
    },

    // Partidos Políticos
    PARTIDOS: {
      LISTA: {
        PATH: '/composicao/lista/partidos',
        PARAMS: { v: 1, format: 'json' }
      }
    },

    // Mesas Diretoras
    MESAS: {
      SENADO: {
        PATH: '/composicao/mesaSF',
        PARAMS: { v: 1, format: 'json' }
      },
      CONGRESSO: {
        PATH: '/composicao/mesaCN',
        PARAMS: { v: 1, format: 'json' }
      }
    },

    // Lideranças
    LIDERANCAS: {
      LISTA: {
        PATH: '/composicao/lideranca',
        PARAMS: { v: 1, format: 'json' }
      },
      TIPOS_UNIDADE: {
        PATH: '/composicao/lideranca/tipos-unidade',
        PARAMS: { v: 1, format: 'json' }
      },
      TIPOS_LIDERANCA: {
        PATH: '/composicao/lideranca/tipos',
        PARAMS: { v: 1, format: 'json' }
      },
      TIPOS_CARGO: {
        PATH: '/composicao/lista/tiposCargo',
        PARAMS: { v: 1, format: 'json' }
      }
    }
  },

  // Comissões
  COMISSOES: {
    TIPOS: {
      PATH: '/comissao/lista/tiposColegiado',
      PARAMS: { v: 3, format: 'json' }
    },
    LISTA_ATIVAS: {
      PATH: '/comissao/lista/colegiados',
      PARAMS: { v: 3, format: 'json' }
    },
    LISTA_POR_TIPO_SENADO: {
      PATH: '/comissao/lista/{tipo}',
      PARAMS: { v: 3, format: 'json' }
    },
    LISTA_POR_TIPO_CONGRESSO: {
      PATH: '/composicao/lista/cn/{tipo}',
      PARAMS: { v: 3, format: 'json' }
    },
    DETALHES: {
      PATH: '/comissao/{codigo}',
      PARAMS: { v: 3, format: 'json' }
    },
    COMPOSICAO_SENADO: {
      PATH: '/composicao/comissao/{codigo}',
      PARAMS: { v: 3, format: 'json' }
    },
    COMPOSICAO_CONGRESSO: {
      PATH: '/composicao/comissao/atual/mista/{codigo}',
      PARAMS: { v: 3, format: 'json' }
    },
    MISTAS: {
      PATH: '/comissao/lista/mistas',
      PARAMS: { v: 3, format: 'json' }
    }
  },

  // Senadores
  SENADORES: {
    LISTA_ATUAL: {
      PATH: '/senador/lista/atual',
      PARAMS: { v: 4, format: 'json' }
    },
    LISTA_LEGISLATURA: {
      PATH: '/senador/lista/legislatura/{legislatura}',
      PARAMS: { v: 4, format: 'json' }
    },
    PERFIL: {
      PATH: '/senador/{codigo}',
      PARAMS: { v: 6, format: 'json' }
    },
    MANDATOS: {
      PATH: '/senador/{codigo}/mandatos',
      PARAMS: { v: 5, format: 'json' }
    },
    CARGOS: {
      PATH: '/senador/{codigo}/cargos',
      PARAMS: { v: 5, format: 'json' }
    },
    COMISSOES: {
      PATH: '/senador/{codigo}/comissoes',
      PARAMS: { v: 5, format: 'json' }
    },
    FILIACOES: {
      PATH: '/senador/{codigo}/filiacoes',
      PARAMS: { v: 5, format: 'json' }
    },
    HISTORICO_ACADEMICO: {
      PATH: '/senador/{codigo}/historicoAcademico',
      PARAMS: { v: 1, format: 'json' }
    },
    LICENCAS: {
      PATH: '/senador/{codigo}/licencas',
      PARAMS: { v: 6, format: 'json' }
    },
    PROFISSAO: {
      PATH: '/senador/{codigo}/profissao',
      PARAMS: { v: 1, format: 'json' }
    },
    APARTES: {
      PATH: '/senador/{codigo}/apartes',
      PARAMS: { v: 5, format: 'json' }
    },
    DISCURSOS: {
      PATH: '/senador/{codigo}/discursos',
      PARAMS: { v: 5, format: 'json' }
    },
    VOTACOES: {
      PATH: '/senador/{codigo}/votacoes',
      PARAMS: { v: 7, format: 'json' }
    },
    // O endpoint /senador/{codigo}/liderancas está marcado como DEPRECATED
    // Vamos usar o endpoint de composição/lideranca com filtro por parlamentar
    LIDERANCAS: {
      PATH: '/composicao/lideranca',
      PARAMS: { v: 1, format: 'json' }
    }
  },

  // Matérias Legislativas e Processos
  PROCESSO: {
    AUTORIAS: {
      PATH: '/processo',
      PARAMS: { v: 1, format: 'json' }
    },
    RELATORIAS: {
      PATH: '/processo/relatoria',
      PARAMS: { v: 1, format: 'json' }
    },
    DETALHES: {
      PATH: '/materia/{codigo}',
      PARAMS: { v: 1, format: 'json' }
    },
    TRAMITACAO: {
      PATH: '/materia/{codigo}/tramitacao',
      PARAMS: { v: 1, format: 'json' }
    }
  },

  // Configurações para formatos de resposta
  FORMAT: 'json',  // Usado nos endpoints que não têm extensão .json explicitamente

  // Configurações de requisição
  REQUEST: {
    TIMEOUT: 45000,  // 45 segundos
    RETRY_ATTEMPTS: 5,
    RETRY_DELAY: 3000  // 3 segundos
  }
};
