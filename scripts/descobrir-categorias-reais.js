/**
 * 🎯 DESCOBRIR CATEGORIAS REAIS - SCRIPT SIMPLIFICADO
 * 
 * Este script vai direto ao ponto: descobrir EXATAMENTE quais 
 * categorias existem no Firestore e seus hashes corretos
 */

console.log('🎯 [DESCOBRIR] Descobrindo categorias reais no Firestore...')

async function descobrirCategoriasReais() {
  try {
    if (typeof window === 'undefined' || !window.firebase) {
      console.error('❌ Firebase não disponível - execute no browser em http://localhost:5173/gastos/premiacoes')
      return
    }

    const db = window.firebase.firestore()
    
    console.log('🔍 [DESCOBRIR] Buscando TODOS os documentos de rankings...')
    
    // Buscar TODOS os documentos da coleção rankings
    const rankingsSnapshot = await db.collection('rankings').get()
    
    const categoriasEncontradas = new Map()
    let totalDocumentos = 0
    let documentosComRanking = 0
    
    rankingsSnapshot.forEach(doc => {
      totalDocumentos++
      const data = doc.data()
      const id = doc.id
      
      // Verificar se tem ranking com dados
      if (data.ranking && data.ranking.length > 0) {
        documentosComRanking++
        
        // Extrair informações da categoria
        const categoria = data.categoria
        if (categoria && categoria.trim() !== '') {
          
          // Tentar extrair hash do ID (padrão V3: nome-hash-periodo)
          const matchV3 = id.match(/^(.+)-([a-f0-9]{8})-(historico|\d{4})$/)
          let hash = null
          
          if (matchV3) {
            hash = matchV3[2]
          }
          
          // Armazenar informações da categoria
          const categoriaKey = categoria.toUpperCase()
          if (!categoriasEncontradas.has(categoriaKey)) {
            categoriasEncontradas.set(categoriaKey, {
              nome: categoria,
              hash: hash,
              documentos: [],
              totalDeputados: 0
            })
          }
          
          // Adicionar documento à categoria
          const catInfo = categoriasEncontradas.get(categoriaKey)
          catInfo.documentos.push({
            id: id,
            periodo: data.periodo || 'desconhecido',
            quantidadeDeputados: data.ranking.length,
            primeiroColocado: data.ranking[0]?.nome || 'N/A'
          })
          catInfo.totalDeputados += data.ranking.length
        }
      }
    })
    
    console.log(`✅ Total de documentos analisados: ${totalDocumentos}`)
    console.log(`📊 Documentos com ranking: ${documentosComRanking}`)
    console.log(`🏷️ Categorias únicas encontradas: ${categoriasEncontradas.size}`)
    
    console.log('\n📋 [DESCOBRIR] === TODAS AS CATEGORIAS REAIS ===')
    
    const categoriasArray = Array.from(categoriasEncontradas.entries()).sort()
    
    categoriasArray.forEach(([categoriaKey, info], index) => {
      console.log(`\n${index + 1}. "${info.nome}"`)
      console.log(`   🔑 Hash: ${info.hash || 'N/A'}`)
      console.log(`   📊 Documentos: ${info.documentos.length}`)
      console.log(`   👥 Total deputados: ${info.totalDeputados}`)
      
      // Mostrar alguns documentos como exemplo
      info.documentos.slice(0, 2).forEach(doc => {
        console.log(`   📄 ${doc.id} (${doc.quantidadeDeputados} deputados)`)
      })
    })
    
    console.log('\n🔍 [DESCOBRIR] === VERIFICAR CATEGORIAS PROBLEMÁTICAS ===')
    
    const categoriesProblematicas = [
      'CONSULTORIAS, PESQUISAS E TRABALHOS TÉCNICOS.',
      'AQUISIÇÃO DE TOKENS E CERTIFICADOS DIGITAIS',
      'PASSAGEM AÉREA - SIGEPA',
      'SERVIÇO DE SEGURANÇA PRESTADO POR EMPRESA ESPECIALIZADA.',
      'PASSAGEM AÉREA - RPA',
      'PASSAGEM AÉREA - REEMBOLSO',
      'LOCAÇÃO OU FRETAMENTO DE EMBARCAÇÕES',
      'LOCAÇÃO OU FRETAMENTO DE AERONAVES'
    ]
    
    const categoriesEncontradas = []
    const categoriesNaoEncontradas = []
    
    for (const catProblematica of categoriesProblematicas) {
      const catKey = catProblematica.toUpperCase()
      const catKeySemPonto = catKey.replace(/\.$/, '')
      const catKeyComPonto = catKeySemPonto + '.'
      
      let encontrada = null
      
      if (categoriasEncontradas.has(catKey)) {
        encontrada = categoriasEncontradas.get(catKey)
      } else if (categoriasEncontradas.has(catKeySemPonto)) {
        encontrada = categoriasEncontradas.get(catKeySemPonto)
      } else if (categoriasEncontradas.has(catKeyComPonto)) {
        encontrada = categoriasEncontradas.get(catKeyComPonto)
      }
      
      if (encontrada) {
        console.log(`✅ "${catProblematica}" → ENCONTRADA`)
        console.log(`   🔑 Hash real: ${encontrada.hash}`)
        console.log(`   📊 ${encontrada.documentos.length} documentos`)
        categoriesEncontradas.push({
          original: catProblematica,
          encontrada: encontrada
        })
      } else {
        console.log(`❌ "${catProblematica}" → NÃO ENCONTRADA`)
        
        // Buscar por palavras-chave
        const palavrasChave = catProblematica.toLowerCase().split(/[-\s,]+/).filter(p => p.length > 3)
        const categoriasRelacionadas = categoriasArray.filter(([key, info]) => {
          const nomeCategoria = info.nome.toLowerCase()
          return palavrasChave.some(palavra => nomeCategoria.includes(palavra))
        })
        
        if (categoriasRelacionadas.length > 0) {
          console.log(`   🔍 Categorias relacionadas encontradas:`)
          categoriasRelacionadas.slice(0, 3).forEach(([key, info]) => {
            console.log(`      - "${info.nome}" (hash: ${info.hash})`)
          })
        }
        
        categoriesNaoEncontradas.push(catProblematica)
      }
    }
    
    console.log('\n💻 [DESCOBRIR] === CÓDIGO TYPESCRIPT ATUALIZADO ===')
    
    if (categoriesEncontradas.length > 0) {
      console.log('✅ Adicione estes hashes REAIS ao seu código:')
      console.log('\n```typescript')
      
      categoriesEncontradas.forEach(({original, encontrada}) => {
        const nomeOriginal = original.toUpperCase()
        const nomeSemPonto = nomeOriginal.replace(/\.$/, '')
        const nomeComPonto = nomeSemPonto + '.'
        
        if (encontrada.hash) {
          console.log(`'${nomeOriginal}': '${encontrada.hash}',`)
          if (!nomeOriginal.endsWith('.')) {
            console.log(`'${nomeComPonto}': '${encontrada.hash}',`)
          } else {
            console.log(`'${nomeSemPonto}': '${encontrada.hash}',`)
          }
        }
      })
      
      console.log('```')
    }
    
    console.log('\n📊 [DESCOBRIR] === RESUMO FINAL ===')
    console.log(`📄 Total de documentos: ${totalDocumentos}`)
    console.log(`📊 Documentos com dados: ${documentosComRanking}`)
    console.log(`🏷️ Categorias disponíveis: ${categoriasEncontradas.size}`)
    console.log(`✅ Categorias problemáticas encontradas: ${categoriesEncontradas.length}/${categoriesProblematicas.length}`)
    console.log(`❌ Categorias problemáticas não encontradas: ${categoriesNaoEncontradas.length}/${categoriesProblematicas.length}`)
    
    if (categoriesNaoEncontradas.length > 0) {
      console.log('\n⚠️ [ATENÇÃO] Categorias que realmente NÃO EXISTEM no Firestore:')
      categoriesNaoEncontradas.forEach(cat => {
        console.log(`   - "${cat}"`)
      })
      console.log('\n💡 Estas categorias podem não ter dados processados ou ter nomes diferentes no sistema.')
    }
    
    // Retornar dados estruturados
    return {
      totalCategorias: categoriasEncontradas.size,
      categoriesEncontradas,
      categoriesNaoEncontradas,
      todasCategorias: Array.from(categoriasEncontradas.values())
    }
    
  } catch (error) {
    console.error('❌ [DESCOBRIR] Erro na descoberta:', error)
    return null
  }
}

// Executar se estiver no browser
if (typeof window !== 'undefined') {
  console.log('🌐 Executando descoberta no browser...')
  descobrirCategoriasReais().then(resultado => {
    if (resultado) {
      console.log('\n🎉 [DESCOBRIR] Descoberta concluída! Use os hashes mostrados acima para corrigir o código.')
    }
  })
} else {
  console.log('📄 Script carregado - execute descobrirCategoriasReais() para iniciar')
}

// Disponibilizar função global
if (typeof window !== 'undefined') {
  window.descobrirCategoriasReais = descobrirCategoriasReais
  console.log('🔧 Função disponível em window.descobrirCategoriasReais()')
}