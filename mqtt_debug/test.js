const fs = require('fs');

let content = {};

fs.readFile('mqtt_debug/structures_1770733097373.json', 'utf8', (err, data) => {
    if (err) {
        console.error('Error leyendo el archivo:', err);
        return;
    }

    try {
        content = JSON.parse(data);
        const udtDefinition = content.udtDefinition;
         const startPath = udtDefinition.fullPath.pathParts.join('/');

        const result = getOutputNodesForUdt(
            udtDefinition.name,
            startPath,
            content.nodes,
        );

        console.log('Output nodes for UDT:', result);

        return result;
    } catch (parseErr) {
        console.error('Error parseando JSON:', parseErr);
    }
});

function getOutputNodesForUdt(udtName, startPath, nodes) {
    // Find the UDT node by subTypeId
    const udtNode = nodes.find(
        (node) =>
            node.params.sourceMetadata &&
            node.params.sourceMetadata.subTypeId === udtName &&
            nodes.some(nodeI => nodeI.path && nodeI.path.includes(`${node.label}.OUTPUTS.`)) // Ensure there are OUTPUTS nodes under this UDT,
    );

    if (!udtNode) {
        return [];
    }

    // Get the original path from the node (before normalization)
    const udtNodePath = udtNode.path;
    if (!udtNodePath) {
        return [];
    }

    // Convert path format (dots to slashes) for comparison
    const udtNodePathNormalized = udtNodePath
        .replace(/\./g, '/')
        .replace('/Groups', '');

    // Find all nodes that start with UDT path + /OUTPUTS/
    const outputNodes = nodes
        .filter((node) => {
            const nodePath = node.path;
            if (!nodePath) return false;

            const nodePathNormalized = nodePath
                .replace(/\./g, '/')
                .replace('/Groups', '');

            return nodePathNormalized.startsWith(
                `${udtNodePathNormalized}/OUTPUTS/`,
            );
        })
        .map((node) => {
            const nodePath = node.path;
            const nodePathNormalized = nodePath
                .replace(/\./g, '/')
                .replace('/Groups', '');

            // Extract the part after /OUTPUTS/
            const pathParts = nodePathNormalized.split('/OUTPUTS/');
            if (pathParts.length === 2) {
                return `${startPath}/OUTPUTS/${pathParts[1]}`;
            }
            return null;
        })
        .filter((path) => path !== null);

    return outputNodes;
}