/*
 * AutoRepo-Worker: a worker script to trigger GitHub builds with Webhooks.
 * Copyright (C) 2024  Ethan Henderson (zbee) <ethan@zbee.codes>
 *
 * This program is free software: you can redistribute it and/or modify it under
 * the terms of the GNU Affero General Public License as published by the Free Software
 * Foundation, either version 3 of the License, or (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful, but WITHOUT ANY
 * WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR A
 * PARTICULAR PURPOSE. See the GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License along with this
 * program. If not, see <https://www.gnu.org/licenses/>.
 */

/**
 * Version of the script to refer to.
 * Name comes from https://en.wikipedia.org/wiki/List_of_bats
 * @type {string}
 */
const version = "0.0.1 alecto";

/**
 * URL to the Repository with the Repository Variables that
 * are users' keys
 * @type {string}
 */
const keys_url = "https://api.github.com/repos/Just-Some-Plugins/AutoRepo/actions/variables";

/**
 * Method to verify the signature sent with the hook matches the secret
 * @param secret {string} to verify the signature against
 * @param header {string} The signature sent with the hook
 * @param payload {string} The body of the request from GitHub
 * @returns {Promise<boolean>}
 * @see https://docs.github.com/en/webhooks/using-webhooks/validating-webhook-deliveries#validating-webhook-deliveries
 */
async function verifySignature(secret, header, payload) {
    let encoder = new TextEncoder();
    let parts = header.split("=");
    let sigHex = parts[1];

    let algorithm = {name: "HMAC", hash: {name: 'SHA-256'}};

    let keyBytes = encoder.encode(secret);
    let extractable = false;
    let key = await crypto.subtle.importKey(
        "raw",
        keyBytes,
        algorithm,
        extractable,
        ["sign", "verify"],
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

/**
 * Method to convert a hex string to a Uint8Array of bytes
 * @param hex {string} The hex string to convert
 * @returns {Uint8Array} The bytes represented by the hex string
 * @see https://docs.github.com/en/webhooks/using-webhooks/validating-webhook-deliveries#validating-webhook-deliveries
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

/**
 * Method to treat URL after the TLD as a `/`-separated list,
 * and break it apart
 * @param inputString {string} The URL string after the TLD
 * @returns {unknown[]|*[]} An empty Array, or an array of
 * strings that were separated by `/`s before
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

/**
 * Method to search for allowed repository labels within the
 * parts of the URL
 * @param url {string} The URL after the TLD
 * @param keys {{}} Output from get_allowed_keys()
 * @returns {Response|boolean} an error Response or boolean
 * of whether the repo is allowed
 */
function repo_allowed(url, keys) {
    const urlParts = getURLParts(url);

    // Get the Allowed Repos from the ALLOWED_REPOS variable on AutoRepo
    let allowed_repos = [];
    for (let key in keys) {
        let name = key;
        let repos = keys[key];

        if (name === "ALLOWED_REPOS")
            allowed_repos = (repos.split(',')).map(part => part.replace(/(\r\n|\n|\r)/gm, "").trim());
    }

    // Report on now Allowed Repos
    if (allowed_repos.length === 0) {
        // todo: report as a github bot error
        return new Response("{'error': 'No Permissible Repositories'}");
    }

    // Check each part against allowedRepos
    for (const part of urlParts)
        if (allowed_repos.includes(part))
            return true;

    return false;
}

/**
 * Method to get all the currently allowable keys from the Repository Variables on AutoRepo
 * @param env Environment Variables from worker request
 * @returns {Promise<Response|{}>} awaited error Response or object of keys
 */
async function get_allowed_keys(env) {
    // Get valid Keys from AutoRepo's Variables
    let keys_request = new Request(keys_url);
    keys_request.headers.set('User-Agent', 'AutoRepo-Worker');
    keys_request.headers.set('Accept', 'application/vnd.github+json');
    keys_request.headers.set('Authorization', 'Bearer ' + env.Read_Keys);
    keys_request.headers.set('X-GitHub-Api-Version', '2022-11-28');
    let keys_response = await fetch(keys_request);
    if (keys_response.status !== 200) {
        // todo: report as a github bot error
        return new Response("{'error': 'Broken GitHub Secrets', 'errorDetails': '" + await keys_response.text() + "'}");
    }

    // Parse the Keys from the Repository Variables
    let keys = {};
    let keys_json = await keys_response.json();
    keys_json = keys_json["variables"];
    for (let key in keys_json) {
        key = keys_json[key];
        key["name"] = key["name"].charAt(0) + key["name"].slice(1).toLowerCase();
        keys[key["name"]] = key["value"];
    }

    if (Object.keys(keys).length === 0) {
        // todo: report as a github bot error
        return new Response("{'error': 'No GitHub Secrets'}");
    }

    return keys;
}

/*
 * Method to call the majority of the methods above, searching for the desired triggers,
 * and forming a standard struct to create a buil-triggering comment with.
 * @param used_key The owner of the key that was used
 * @param url The URL from Cloudflare built into a URL object
 * @param payload The body of the request from GitHub
 * @returns instanceof Response Error Response
 * @return {string:string} Trigger Structure
 */
function parse_trigger(used_key, url, payload) {
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
        worker_version: version,
        key_owner: used_key,
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

    // Get valid Keys from AutoRepo's Variables
    let keys = await get_allowed_keys(env);
    if (keys instanceof Response)
        return keys;

  // Verify secrets sent against those from AutoRepo
  let payload = JSON.stringify(await request.json());
  let used_key = 'unknown';
  let any_verified = false;
  for (let key in keys) {
    let name = key;
    key = keys[key];
    // Try to verify this key
    let verified = await verifySignature(
      key,
      request.headers.get("x-hub-signature-256"),
      payload
    );
    // Save it if it passes
    if (verified) {
      used_key = name;
      any_verified = true;
      break;
    }
  }
  // Reject nonmatching secrets
  if (!any_verified)
    return new Response("{'error': 'Non-Permissible Key'}");


    // Reject nonexistent repo options
    const url = new URL(request.url);
    if (!repo_allowed(url.pathname, keys))
        return new Response("{'error': 'Non-Permissible Repository'}");

    // Parse request
    let trigger_data = parse_trigger(used_key, url, payload);
    if (trigger_data instanceof Response)
        return trigger_data;

    console.info(
        trigger_data,
    );

    // Recreate the response so we can modify the headers
    let response = new Response(JSON.stringify(trigger_data));

    // Set CORS headers
    response.headers.set('Access-Control-Allow-Origin', request.headers.get('Origin'));
    // Append to/Add Vary header so browser will cache response correctly
    response.headers.append('Vary', 'Origin');

    return response;
}

//region Router
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
//endregion
