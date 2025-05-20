async function fetchLeetCodeProblem(url) {
  try {
    // Validate URL format
    const match = url.match(/^https:\/\/leetcode\.com\/problems\/([a-z0-9-]+)\/?$/);
    if (!match) {
      throw new Error("Invalid URL. Please enter a correct LeetCode problem URL.");
    }

    const res = await fetch("https://revsy-backend.vercel.app/api/leetcode", {
      method: "POST",
      headers: {
        "content-Type": "application/json",
        "Accept": "application/json",
      },
      body: JSON.stringify({
        url: url,
      }),
    });
    // console.log(res);

    if (!res.ok) {
      throw new Error("Failed to fetch problem data. Please try again later.");
    }

    const json = await res.json();

    return {
      title: json.title,
      description: json.description,
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


console.log(await fetchLeetCodeProblem("https://leetcode.com/problems/two-sum/"));