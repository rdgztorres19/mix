
class GitHubService {
    /**
     * Crea una instancia del servicio GitHub.
     * @param {Object} config - Configuración necesaria.
     * @param {string} config.token - Token de autenticación de GitHub.
     * @param {string} config.owner - Nombre del owner del repositorio.
     * @param {string} config.repo - Nombre del repositorio.
     */
    constructor({ token, owner, repo }) {
        this.owner = owner;
        this.repo = repo;
        this.token = token;
    }

    async init() {
        const { Octokit } = await import('@octokit/rest');
        this.octokit = new Octokit({ auth: this.token });
    }

    /**
     * Obtiene la información de un archivo en el repositorio.
     * @param {string} path - Ruta del archivo.
     * @returns {Promise<Object>} - Objeto con la información del archivo.
     */
    async getFile(path) {
        try {
            const { data } = await this.octokit.repos.getContent({
                owner: this.owner,
                repo: this.repo,
                path,
            });
            return data;
        } catch (error) {
            throw new Error(`Error al obtener el archivo en "${path}": ${error.message}`);
        }
    }

    /**
     * Sube o actualiza un archivo en el repositorio.
     * Si el archivo existe se actualiza; de lo contrario se crea.
     * @param {Object} params - Parámetros para subir el archivo.
     * @param {string} params.path - Ruta del archivo.
     * @param {string} params.content - Contenido del archivo (texto plano).
     * @param {string} params.commitMessage - Mensaje del commit.
     * @returns {Promise<Object>} - Respuesta de la API de GitHub.
     */
    async uploadFile({ path, content, commitMessage }) {
        try {
            let sha;
            // Verifica si el archivo ya existe para obtener su sha.
            try {
                const fileData = await this.getFile(path);
                sha = fileData.sha;
            } catch (error) {
                // Si no existe, se ignora el error y se crea el archivo.
                sha = undefined;
            }

            // Codifica el contenido a base64
            const base64Content = Buffer.from(content).toString('base64');

            const params = {
                owner: this.owner,
                repo: this.repo,
                path,
                message: commitMessage,
                content: base64Content,
                ...(sha && { sha }) // Agrega el sha si existe
            };

            const { data } = await this.octokit.repos.createOrUpdateFileContents(params);
            return data;
        } catch (error) {
            throw new Error(`Error al subir/actualizar el archivo en "${path}": ${error.message}`);
        }
    }

    /**
     * Descarga el contenido de un archivo del repositorio.
     * @param {string} path - Ruta del archivo.
     * @returns {Promise<string>} - Contenido del archivo en texto plano.
     */
    async downloadFile(path) {
        try {
            const fileData = await this.getFile(path);
            // Decodifica el contenido desde base64 a utf8
            return Buffer.from(fileData.content, 'base64').toString('utf8');
        } catch (error) {
            throw new Error(`Error al descargar el archivo en "${path}": ${error.message}`);
        }
    }
}

const config = {
    token: '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',
    owner: 'rdgztorres19',
    repo: 'sorba'
};

const github = new GitHubService(config);

(async () => {
    try {
        await github.init();

        // const uploadResponse = await github.uploadFile({
        //     path: 'folder/MOTOR_BEARING_PROBLEM_DS_part1.csv',
        //     content: 'Este es el contenido del archivo actualizado11111',
        //     commitMessage: 'Actualización del archivo'
        // });

        const fileContent = await github.downloadFile('folder/MOTOR_BEARING_PROBLEM_DS_part1.csv');
        console.log('Contenido del archivo:', fileContent);
    } catch (error) {
        console.error(error.message);
    }
})();