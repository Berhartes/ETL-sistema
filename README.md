# 🏛️ Sistema ETL - Transparência Parlamentar

## **Visão Geral**
Sistema especializado para ETL (Extract, Transform, Load) de dados parlamentares, separado completamente do frontend para arquitetura limpa.

## **Estrutura**
```
📁 Sistema ETL/
├── 📁 config/          → Configurações ETL e Firebase
├── 📁 scripts/         → Scripts CJS de processamento
├── 📁 services/        → Serviços Firestore e rankings
├── 📁 utils/           → Utilitários de processamento
├── 📁 docs/            → Documentação do sistema ETL
└── 📄 README.md        → Este arquivo
```

## **Funcionalidades**
- ✅ **Extração**: APIs Câmara e Senado
- ✅ **Transformação**: Processamento e categorização
- ✅ **Carregamento**: Firebase/Firestore
- ✅ **Análises**: Rankings e métricas
- ✅ **Correções**: Scripts de manutenção

## **Separação Arquitetural**
- **Frontend**: `/gastosdeputados` - Interface pura sem Firebase
- **ETL**: `/Sistema ETL` - Processamento e persistência

## **Status**
🚀 Sistema extraído e organizado para operação independente
