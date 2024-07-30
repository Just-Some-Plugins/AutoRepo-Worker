
/*
 * Options available for target repository destinations
 */
const allowed_repos = [ "jsp", "zbee", "individual" ];

/*
 * URL to Repo with Repository Variables that are users' keys
 */
let keys_url = "https://api.github.com/repos/Just-Some-Plugins/AutoRepo/actions/variables";

/*
 * Method to verify the secret sent with the hook matches one of the keys along with the payload
 * @param secret A key the hashed secret should equal
 * @param header The hashed secret+payload sent with the hook
 * @param payload The request body that when paired with the secret should equal what GitHub sent
 * @returns <boolean> of whether the secret equals the key used to generate what GitHub sent
 */
async function verifySignature(secret, header, payload) {
    let encoder = new TextEncoder();
    let parts = header.split("=");
    let sigHex = parts[1];

    let algorithm = { name: "HMAC", hash: { name: 'SHA-256' } };

    let keyBytes = encoder.encode(secret);
    let extractable = false;
    let key = await crypto.subtle.importKey(
        "raw",
        keyBytes,
        algorithm,
        extractable,
        [ "sign", "verify" ],
    );

    let sigBytes = hexToBytes(sigHex);
    let dataBytes = encoder.encode(payload);
    let equal = await crypto.subtle.verify(
        algorithm.name,
        key,
        sigBytes,
        dataBytes,
    );

    return equal;
}

/*
 * Method to convert hashed hex to byte data for comparison
 * @parm hex The hash hex to convert back to byte data
 * @returns Uint8Array of bytes
 */
function hexToBytes(hex) {
    let len = hex.length / 2;
    let bytes = new Uint8Array(len);

    let index = 0;
    for (let i = 0; i < hex.length; i += 2) {
        let c = hex.slice(i, i + 2);
        let b = parseInt(c, 16);
        bytes[index] = b;
        index += 1;
    }

    return bytes;
}

/*
 * Method to treat URL after the TLD as a /-separated list, and break it apart
 * @param inputString The URL string after the TLD
 * @returns string[] An empty Array, or an array of strings that were separated by /s before
 */
function getURLParts(inputString) {
  // Remove leading and trailing slashes (if any)
  const cleanedString = inputString.replace(/^\/|\/$/g, '');

  // Split the string by forward slashes
  const parts = cleanedString.split('/');

  // Find the index of "trigger"
  const triggerIndex = parts.indexOf('trigger');

  if (triggerIndex !== -1 && triggerIndex < parts.length - 1) {
      // Get non-empty values after "trigger"
      const nonEmptyValues = parts.slice(triggerIndex + 1).filter(part => part.trim() !== '');

      return nonEmptyValues;
  } else {
      return []; // No valid values found after "trigger"
  }
}

/*
 * Method to search for allowed repository labels within the parts of the URL
 * @param url The URL string after the TLD
 * @returns boolean If there was at least 1 allowed repository label
 */
function repo_allowed(url) {
    const urlParts = getURLParts(url);

    // Check each part against allowedRepos
    for (const part of urlParts)
        if (allowed_repos.includes(part))
            return true

    return false;
}

/*
 * Method to call the majority of the methods above, searching for the desired triggers,
 * and forming a standard struct to create a buil-triggering commen with.
 * @param url The URL from Cloudflare built into a URL object
 * @param payload The body of the request from GitHub
 * @return Trigger Struct
 */
function parse_trigger(url, payload) {
    // URL Parts
    let endpoint = url.pathname;
    let destination = getURLParts(endpoint);
    if (destination.length < 1)
      return new Response("{'error': 'Non-Permissible Trigger'}");
    
    // URL parameters
    let getParams = {};
    for (const [key, value] of url.searchParams)
        getParams[key] = value;
    
    // Check Payload
    payload = JSON.parse(payload);
    if (!("repository" in payload))
        return new Response("{'error': 'Unexpected Request Body'}");
    
    // Build base trigger data
    let trigger = {
        target_repo: destination[0],
        target_name: null,
        branch_main: null,
        branch_test: null,
        code_repo: payload["repository"]["full_name"],
        code_private: payload["repository"]["private"],
        code_owner: payload["repository"]["owner"]["login"],
        code_url: payload["repository"]["html_url"],
    };
    
    // Build out additional trigger data
    // Get branch data
    if ("main" in getParams)
        trigger["branch_main"] = getParams["main"];
    if ("test" in getParams)
        trigger["branch_test"] = getParams["main"];
    if (!("test" in getParams) && !("main" in getParams))
        trigger["branch_main"] = "main";
    // Get metadata
    if ("target_name" in getParams && trigger.target_repo === "individual")
        trigger["target_name"] = getParams["target_name"];
    
    return trigger;
}

async function handleRequest(request, env) {    
    // Reject anything other than hookshot going to /trigger/
    if (!request.headers.get("user-agent") ||
        !request.headers.get("x-github-delivery") ||
        !request.headers.get("x-github-event") ||
        !request.headers.get("x-hub-signature-256") ||
        !request.headers.get("user-agent").startsWith("GitHub-Hookshot") ||
        !request.headers.get("x-hub-signature-256").startsWith("sha256=") ||
        request.url.indexOf("trigger") === -1)
        return new Response("{'error': 'Non-Permissible Origin'}");
    
    // todo: get keys from AutoRepo here
    // Get valid Keys from AutoRepo's Variables
    let keys_request = new Request(keys_url);
    keys_request.headers.set('Authorization', 'Bearer ' + env.Read_Keys);
    keys_request.headers.set('X-GitHub-Api-Version', '2022-11-28');
    let keys_response = await fetch(keys_request, {
        cf: {
            cacheTtlByStatus: { "200-299": 1, "400-599": 0 },
            cacheEverything: true,
        }
    });
    // Parse the Keys from the Repository Variables
    if (keys_response.status === 200) {
        let keys = await keys_response.json();
        console.log(keys);
    }
    
    // Verify secrets sent against those in AutoRepo
    let payload = JSON.stringify(await request.json());
    let verified = await verifySignature(
        'test-secret',
        request.headers.get("x-hub-signature-256"),
        payload
    );
    // Reject nonmatching secrets
    if (!verified)
        return new Response("{'error': 'Non-Permissible Key'}");
    
    // Reject nonexistant repo options
    const url = new URL(request.url);
    if (!repo_allowed(url.pathname))
        return new Response("{'error': 'Non-Permissible Repository'}");
    
    // Parse request
    let trigger_data = parse_trigger(url, payload);

    console.info(
      trigger_data,
    );

	/*
    let riotRequest = new Request(fullUrl, request);
    riotRequest.headers.set('X-Riot-Token', env.riot_key);
    let response = await fetch(riotRequest, {
        cf: {
            cacheTtlByStatus: { "200-299": 1, "400-599": 0 },
            cacheEverything: true,
        }
    });
    
    if (response.status == 400) {
      return new Response(
            '["error", "400-series", "Wrong region: try continent (or, wrong parameters: check docs)", '
            + '"' + region + '", "' + fullUrl + '"]',
            null
        );
    }
    */

    // Recreate the response so we can modify the headers
	let response = new Response(JSON.stringify(trigger_data));

    // Set CORS headers
    response.headers.set('Access-Control-Allow-Origin', request.headers.get('Origin'));
    // Append to/Add Vary header so browser will cache response correctly
    response.headers.append('Vary', 'Origin');

    return response;
}

export default {
    async fetch(request, env) {
        if (request.method === 'GET' || request.method === 'POST') {
            // Handle requests to the API server
            return handleRequest(request, env);
        } else {
            return new Response(null, {
                status: 405,
                statusText: 'Method Not Allowed',
            });
        }
    }
}
