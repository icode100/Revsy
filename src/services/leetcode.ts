export async function fetchLeetCodeProblem(url:string):Promise<{ title: string; description: string }> {
  try {
    // Validate URL format
    const match = url.match(/^https:\/\/leetcode\.com\/problems\/([a-z0-9-]+)\/?(description\/?)?$/);
    if (!match) {
      throw new Error("Invalid URL. Please enter a correct LeetCode problem URL.");
    }

    const res = await fetch("https://revsy-backend.vercel.app/api/leetcode", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ 
        url: url 
      }),
    });

    if (!res.ok) {
      throw new Error("Failed to fetch problem data. Please try again later.");
    }

    const question = await res.json();

    if (!question) {
      throw new Error("Problem not found.");
    }

    return {
      title: question.title,
      description: question.description,
    };

  } catch (error) {
    if (error instanceof Error) {
      if (error.message.includes("cors")) {
        throw new Error(
          "CORS error: Please visit https://cors-anywhere.herokuapp.com/corsdemo to activate demo access"
        );
      }
    }
    throw error;
  }
}