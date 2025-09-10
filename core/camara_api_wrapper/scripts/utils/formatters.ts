/**
 * Formata uma string de CNPJ ou CPF, removendo caracteres não numéricos
 * e aplicando a máscara correspondente.
 * 
 * @param cnpjCpf A string contendo o CNPJ ou CPF.
 * @returns O número formatado ou a string original se não for um CNPJ/CPF válido.
 */
export function formatarCnpjCpf(cnpjCpf: string | null | undefined): string | null {
    if (!cnpjCpf) {
        return null;
    }

    const digitos = cnpjCpf.replace(/\D/g, '');

    if (digitos.length === 14) {
        // Formato CNPJ: XX.XXX.XXX/XXXX-XX
        return digitos.replace(
            /(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/,
            '$1.$2.$3/$4-$5'
        );
    }

    if (digitos.length === 11) {
        // Formato CPF: XXX.XXX.XXX-XX
        return digitos.replace(
            /(\d{3})(\d{3})(\d{3})(\d{2})/,
            '$1.$2.$3-$4'
        );
    }

    // Retorna o valor original se não for um CNPJ ou CPF com tamanho padrão
    return cnpjCpf;
}
