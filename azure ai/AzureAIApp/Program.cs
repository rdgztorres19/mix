using OpenAI.Chat;
using Azure;
using Azure.AI.OpenAI;

var endpoint = new Uri("https://rdgztorres19-2954-resource.cognitiveservices.azure.com/");
var deploymentName = "gpt-4.1";
var apiKey = Environment.GetEnvironmentVariable("AZURE_API_KEY") ?? throw new InvalidOperationException("AZURE_API_KEY environment variable is required");

AzureOpenAIClient azureClient = new(
    endpoint,
    new AzureKeyCredential(apiKey));
    
ChatClient chatClient = azureClient.GetChatClient(deploymentName);

var requestOptions = new ChatCompletionOptions()
{
    Temperature = 1.0f,
    TopP = 1.0f,
    FrequencyPenalty = 0.0f,
    PresencePenalty = 0.0f,
    
};

List<ChatMessage> messages = new List<ChatMessage>()
{
    new SystemChatMessage("You are a helpful assistant."),
    new UserChatMessage("I am going to Paris, what should I see?"),
};

var response = chatClient.CompleteChat(messages, requestOptions);
System.Console.WriteLine(response.Value.Content[0].Text);