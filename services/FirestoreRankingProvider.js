/**
 * 🔥 PROVEDOR DE RANKINGS DO FIRESTORE
 *
 * Provedor que busca dados diretamente do Firestore,
 * substituindo o sistema antigo com uma interface limpa.
 */
import { categoryRegistry } from '../../categories/CategoryRegistry';
import { firestoreService } from '../../../services/firestore-service';
export class FirestoreRankingProvider {
    name = 'FirestoreRankingProvider';
    priority = 100; // Alta prioridade - dados frescos
    canProvide(query) {
        // Pode fornecer dados para qualquer query
        return true;
    }
    estimateResponseTime(query) {
        // Estima tempo baseado na complexidade da query
        let baseTime = 500; // 500ms base
        if (query.categoryId)
            baseTime += 200; // Filtro por categoria
        if (query.year)
            baseTime += 100; // Filtro por ano
        if (query.deputyIds?.length)
            baseTime += 50; // Filtro por deputados
        return baseTime;
    }
    async fetchData(query) {
        const startTime = Date.now();
        try {
            console.log('🔥 [FirestoreProvider] Fetching data from Firestore');
            // 1. Determinar categoria se especificada
            const category = query.categoryId ? categoryRegistry.getById(query.categoryId) : undefined;
            // 2. Buscar dados baseado no tipo de query
            let deputies = [];
            if (category) {
                // Buscar por categoria específica
                deputies = await this.fetchByCategoryDirect(category.displayName, query.year);
            }
            else {
                // Buscar ranking geral
                deputies = await this.fetchGeneralRankingDirect(query.year);
            }
            // 3. Aplicar filtros adicionais
            deputies = this.applyFilters(deputies, query);
            // 4. Ordenar e paginar
            deputies = this.sortAndPaginate(deputies, query);
            // 5. Converter para RankingEntry
            const entries = this.convertToRankingEntries(deputies, query);
            // 6. Calcular estatísticas
            const totalAmount = deputies.reduce((sum, d) => sum + d.totalAmount, 0);
            const totalTransactions = deputies.reduce((sum, d) => sum + d.transactionCount, 0);
            // 7. Determinar qualidade dos dados
            const dataQuality = this.assessDataQuality(deputies);
            const result = {
                entries,
                metadata: {
                    categoryId: query.categoryId,
                    categoryName: category?.displayName,
                    year: query.year,
                    period: query.year ? query.year.toString() : 'all',
                    totalDeputies: deputies.length,
                    totalAmount,
                    totalTransactions,
                    dataQuality,
                    confidence: dataQuality === 'high' ? 0.95 : dataQuality === 'medium' ? 0.8 : 0.6,
                    lastUpdate: new Date(),
                    source: 'real-time',
                    processingTime: Date.now() - startTime
                }
            };
            console.log(`✅ [FirestoreProvider] Fetched ${deputies.length} deputies in ${result.metadata.processingTime}ms`);
            return result;
        }
        catch (error) {
            console.error('❌ [FirestoreProvider] Error fetching data:', error);
            return null;
        }
    }
    /**
     * Busca deputados por categoria específica
     */
    async fetchByCategoryDirect(categoryName, year) {
        try {
            // Usar o método existente do firestoreService
            const transactions = await firestoreService.buscarTransacoesPorCategoria(categoryName, year);
            console.log(`📊 [FirestoreProvider] Found ${transactions.length} transactions for category ${categoryName}`);
            // Agrupar por deputado
            const deputyMap = new Map();
            for (const transaction of transactions) {
                const deputyId = transaction.deputadoId || transaction.id;
                if (!deputyId)
                    continue;
                const amount = parseFloat(transaction.valorLiquido || transaction.valorDocumento || transaction.valorReembolsado || 0);
                if (amount <= 0)
                    continue;
                if (!deputyMap.has(deputyId)) {
                    deputyMap.set(deputyId, {
                        id: deputyId,
                        name: transaction.deputadoNome || transaction.nomeDeputado || 'Deputado Não Identificado',
                        civilName: transaction.deputadoNomeCivil || transaction.nomeCivilDeputado || '',
                        party: transaction.deputadoPartido || transaction.siglaPartido || '',
                        state: transaction.deputadoUF || transaction.siglaUf || '',
                        photoUrl: transaction.urlFoto,
                        totalAmount: 0,
                        transactionCount: 0,
                        supplierCount: 0,
                        suppliers: new Set()
                    });
                }
                const deputy = deputyMap.get(deputyId);
                deputy.totalAmount += amount;
                deputy.transactionCount += 1;
                // Contar fornecedores únicos
                const supplierKey = transaction.cnpjCpfFornecedor || transaction.nomeFornecedor;
                if (supplierKey) {
                    deputy.suppliers.add(supplierKey);
                    deputy.supplierCount = deputy.suppliers.size;
                }
            }
            // Converter para array
            return Array.from(deputyMap.values()).map(deputy => ({
                id: deputy.id,
                name: deputy.name,
                civilName: deputy.civilName,
                party: deputy.party,
                state: deputy.state,
                photoUrl: deputy.photoUrl,
                totalAmount: deputy.totalAmount,
                transactionCount: deputy.transactionCount,
                supplierCount: deputy.supplierCount,
                lastUpdate: new Date(),
                dataQuality: 'high'
            }));
        }
        catch (error) {
            console.error('❌ [FirestoreProvider] Error fetching by category:', error);
            return [];
        }
    }
    /**
     * Busca ranking geral (todas as categorias)
     */
    async fetchGeneralRankingDirect(year) {
        try {
            // Para ranking geral, seria necessário buscar de todas as categorias
            // ou ter uma coleção agregada. Por agora, retornar vazio e deixar fallback funcionar
            console.log('⚠️ [FirestoreProvider] General ranking not implemented yet, using fallback');
            return [];
        }
        catch (error) {
            console.error('❌ [FirestoreProvider] Error fetching general ranking:', error);
            return [];
        }
    }
    /**
     * Aplica filtros adicionais à lista de deputados
     */
    applyFilters(deputies, query) {
        let filtered = deputies;
        // Filtro por deputados específicos
        if (query.deputyIds?.length) {
            filtered = filtered.filter(d => query.deputyIds.includes(d.id));
        }
        // Filtro por estados
        if (query.states?.length) {
            filtered = filtered.filter(d => query.states.includes(d.state));
        }
        // Filtro por partidos
        if (query.parties?.length) {
            filtered = filtered.filter(d => query.parties.includes(d.party));
        }
        return filtered;
    }
    /**
     * Ordena e pagina os resultados
     */
    sortAndPaginate(deputies, query) {
        // Ordenação
        const orderBy = query.orderBy || 'amount';
        const direction = query.orderDirection || 'desc';
        deputies.sort((a, b) => {
            let valueA, valueB;
            switch (orderBy) {
                case 'amount':
                    valueA = a.totalAmount;
                    valueB = b.totalAmount;
                    break;
                case 'transactions':
                    valueA = a.transactionCount;
                    valueB = b.transactionCount;
                    break;
                case 'suppliers':
                    valueA = a.supplierCount;
                    valueB = b.supplierCount;
                    break;
                default:
                    valueA = a.totalAmount;
                    valueB = b.totalAmount;
            }
            return direction === 'desc' ? valueB - valueA : valueA - valueB;
        });
        // Paginação
        const offset = query.offset || 0;
        const limit = query.limit;
        if (limit) {
            return deputies.slice(offset, offset + limit);
        }
        return deputies.slice(offset);
    }
    /**
     * Converte deputados para entradas de ranking
     */
    convertToRankingEntries(deputies, query) {
        const totalAmount = deputies.reduce((sum, d) => sum + d.totalAmount, 0);
        return deputies.map((deputy, index) => ({
            deputy,
            position: (query.offset || 0) + index + 1,
            categoryId: query.categoryId,
            year: query.year,
            percentageOfTotal: totalAmount > 0 ? (deputy.totalAmount / totalAmount) * 100 : 0,
            averageTransaction: deputy.transactionCount > 0 ? deputy.totalAmount / deputy.transactionCount : 0,
            trend: 'stable' // TODO: implementar comparação histórica
        }));
    }
    /**
     * Avalia qualidade dos dados
     */
    assessDataQuality(deputies) {
        if (deputies.length === 0)
            return 'low';
        // Verificar completude dos dados
        const completeDeputies = deputies.filter(d => d.name &&
            d.party &&
            d.state &&
            d.totalAmount > 0 &&
            d.transactionCount > 0);
        const completenessRatio = completeDeputies.length / deputies.length;
        if (completenessRatio > 0.9)
            return 'high';
        if (completenessRatio > 0.7)
            return 'medium';
        return 'low';
    }
}
