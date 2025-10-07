const { Client } = require("@modelcontextprotocol/sdk/client/index.js");
const { StreamableHTTPClientTransport } = require("@modelcontextprotocol/sdk/client/streamableHttp.js");
const { StdioClientTransport } = require("@modelcontextprotocol/sdk/client/stdio.js");

const isStdio = false;
const token = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJhZG1pbiIsImVtYWlsIjoicmRnenRvcnJlczE5QGdtYWlsLmNvbSIsInVzZXJJZCI6IkU0cm02T3VlZ3Y4ZiIsInNjb3BlIjpbImFkbWluIl0sImF1dGhvcml6ZWQiOnRydWUsImlhdCI6MTc1NzEwNTUzOCwiZXhwIjoxNzU3MTE5OTM4fQ.RMB365VwOHF2FcbEeYxCVZIN1FmkFlb48Y-6ZUwho68";

const main = async () => {
    const client = new Client(
        {
            name: "example-client",
            version: "1.0.0",
        },
        {
            capabilities: {},
        },
    );

    const transport = isStdio ? new StdioClientTransport({
        command: "node",
        args: ["/Users/rdgztorres19/Documents/Projects/mcp-api/dist/index.js"]
    }) : new StreamableHTTPClientTransport(
        new URL(`http://localhost:8787/mcp`),
    );

    await client.connect(transport);
    const prompts = await client.listTools();

    const postApi = prompts.tools.find(tool => tool.name === "get_users");


    // console.log(JSON.stringify(prompts, null, 2));

    // const result = await client.callTool({
    //     name: "post_apis",
    //     arguments: {
    //         // path: {
    //         //     id: 4275062163735552
    //         // },
    //         body: {
    //             "name": "TREE V2",
    //             "context": "demo",
    //             "version": "v2",
    //             "endpoint": "https://localhost:8081"
    //         },
    //         token: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJhZG1pbiIsImVtYWlsIjoiIiwidXNlcklkIjoiRTRybTZPdWVndjhmIiwic2NvcGUiOlsiYWRtaW4iXSwiYXV0aG9yaXplZCI6dHJ1ZSwiaWF0IjoxNzU3MDMyNjMxLCJleHAiOjE3NTcwNDcwMzF9.bW6NloYjJnvzgEn9UMahCA4fZlu4tD408U91A6CBYAo"
    //     }
    // });

    const result = await client.callTool({
        name: "get_apis",
        arguments: {
            query: {
                page: 1,
                results: 1
            },
            token: token
        }
    });

    console.log(result);
};

main();
