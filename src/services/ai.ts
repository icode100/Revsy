import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { ChatPromptTemplate } from "@langchain/core/prompts";

const model = new ChatGoogleGenerativeAI({
    model: "gemini-2.0-flash",
    temperature: 0.7,
    maxRetries: 2,
    apiKey: import.meta.env.VITE_GOOGLE_API_KEY,
});



export async function summarizeText(text: string): Promise<string> {
    const prompt = ChatPromptTemplate.fromMessages([
        [
            "system",
            "You are a helpful assistant that summarizes the given leetcode dsa problem description in a concise manner mentioning the problem statement and its constraints in a concise manner. ",
        ],
        ["human", "{input}"],
    ]);

    const chain = prompt.pipe(model);
    const response = await chain.invoke({
                            input: text,
                        });
    if(typeof response.content === 'string') return response.content;
    if(Array.isArray(response.content)){
        return response.content
        .map((item: unknown) => {
            if (typeof item === "string") return item;
            if (
                typeof item === "object" &&
                item !== null &&
                "text" in item &&
                typeof (item as { text: unknown }).text === "string"
            ) {
                return (item as { text: string }).text;
            }
            return "";
        })
        .join(" ");
    }
    return "";
}

