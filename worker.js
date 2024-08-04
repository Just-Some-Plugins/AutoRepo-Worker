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
const version = "0.0.2 aequalis";

/**
 * URL to the Repository with the Repository Variables that
 * are users' keys
 * @type {string}
 */
const keys_url = "https://api.github.com/repos/Just-Some-Plugins/AutoRepo/actions/variables";

/**
 * URL to the Issue to add a comment to in order to trigger a
 * build
 * @type {string}
 */
let comment_url = "https://api.github.com/repos/Just-Some-Plugins/AutoRepo/issues/1/comments";

//region Worker restrictions
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
    return await crypto.subtle.verify(
        algorithm.name,
        key,
        sigBytes,
        dataBytes,
    );
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
        bytes[index] = parseInt(c, 16);
        index += 1;
    }

    return bytes;
}

//endregion

/**
 * Method to treat URL after the TLD as a `/`-separated list,
 * and break it apart
 * @param inputString {string} The URL string after the TLD
 * @returns {unknown[]|*[]} An empty Array, or an array of
 * strings that were separated by `/`s before
 */
function get_url_parts(inputString) {
    // Remove leading and trailing slashes (if any)
    let cleanedString = inputString.replace(/^\/|\/$/g, '');
    cleanedString = cleanedString.toLowerCase();

    // Split the string by forward slashes
    const parts = cleanedString.split('/');

    // Find the index of "trigger"
    const triggerIndex = parts.indexOf('trigger');

    if (triggerIndex !== -1 && triggerIndex < parts.length - 1) {
        // Get non-empty values after "trigger"
        return parts.slice(triggerIndex + 1).filter(part => part.trim() !== '');
    } else {
        return []; // No valid values found after "trigger"
    }
}

//region Key restrictions
/**
 * Method to get all the currently allowable keys from the Repository Variables on
 * AutoRepo
 * @param env Environment Variables from worker request
 * @returns {Promise<Response|{}>} awaited error Response or object of keys
 */
async function get_allowed_keys(env) {
    // Get valid Keys from AutoRepo's Variables
    let keys_request = new Request(keys_url, {
        method: 'GET',
        headers: {
            'User-Agent': 'AutoRepo-Worker',
            'Accept': 'application/vnd.github+json',
            'Authorization': 'Bearer ' + env.Read_Keys,
            'X-GitHub-Api-Version': '2022-11-28',
        }
    });
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

/**
 * Method to verify the key used in the request is one of the
 * valid keys
 * @param keys {{}} The keys from the AutoRepo repository,
 * from get_allowed_keys()
 * @param request {Request} The request from the worker
 * @param payload {string} The body of the request from GitHub
 * @returns {Promise<Response|string>} error Response or used
 * key's name
 */
async function verify_key(keys, request, payload) {
    for (let key in keys) {
        let name = key; // key's name
        key = keys[key]; // actual key

        // Skip meta variables
        if (key === "ALLOWED_REPOS" || key === "ALLOWED_REPOS_FOR_USERS") {
            continue;
        }

        // Try to verify this key
        let verified = await verifySignature(
            key,
            request.headers.get("x-hub-signature-256"),
            payload
        );
        // Save it if it passes
        if (verified) {
            return name.toLowerCase();
        }
    }

    return new Response("{'error': 'Non-Permissible Key'}");
}

//endregion

//region Repository restrictions
/**
 * Method to get the allowed repositories from the keys
 * @param keys {{}} Output from get_allowed_keys()
 * @returns {*[]} An array of allowed repositories
 */
function get_allowed_repos(keys) {
    // Get the Allowed Repos from the ALLOWED_REPOS variable on AutoRepo
    let allowed_repos = [];
    for (let key in keys) {
        let name = key.toLowerCase();
        let repos = keys[key].toLowerCase();

        if (name === "allowed_repos") {
            allowed_repos = (repos.split(',')).map(
                part => part.replace(/(\r\n|\n|\r)/gm, "").trim()
            );
        }
    }

    return allowed_repos;
}

/**
 * Method to search for allowed repository labels within the
 * parts of the URL
 * @param url_parts {*[]} The URL parts after the TLD
 * @param keys {{}} Output from get_allowed_keys()
 * @returns {Response|boolean} an error Response or boolean
 * of whether the repo is allowed
 */
function repo_allowed(url_parts, keys) {
    let allowed_repos = get_allowed_repos(keys);

    // Report on now Allowed Repos
    if (allowed_repos.length === 0) {
        // todo: report as a github bot error
        return new Response("{'error': 'No Permissible Repositories'}");
    }

    // Check each part against allowedRepos
    let all_parts_allowed = true;
    for (const part of url_parts)
        if (!allowed_repos.includes(part)) {
            all_parts_allowed = false;
        }

    return all_parts_allowed;
}

/**
 * Method to check if the repository is allowed for the key
 * @param url_parts {*[]} The URL parts after the TLD
 * @param used_key {string} The owner of the key that was used
 * @param keys {{}} Output from get_allowed_keys()
 * @returns {boolean} Whether the repo is allowed for the key
 */
function repo_allowed_for_key(url_parts, used_key, keys) {
    used_key = used_key.toLowerCase();
    let allowed_repos = get_allowed_repos(keys);

    // Get the allowed repos for the used key
    let allowed_repos_for_key = [];
    for (let key in keys) {
        let variable_name = key.toLowerCase();
        let variable_value = keys[key];

        // Find the allowed repos for each key
        if (variable_name === "allowed_repos_for_users") {
            // Split the repos into an array for each key
            let values = variable_value.split('\n');
            for (let value in values) {
                value = values[value].toLowerCase();
                let user_parts = value.split(':');

                // Get the key owner name
                let user_name = user_parts[0].replace(/(\r\n|\n|\r)/gm, "").trim();

                // Skip other keys
                if (user_name !== used_key.split('__')[0]) {
                    continue;
                }

                // Get the allowed repos for the key owner
                let user_allowances = user_parts[1].trim();
                let user_allowed_repos = [];
                if (user_allowances === "-") {
                    user_allowed_repos = [];
                } else if (user_allowances === "*") {
                    user_allowed_repos = allowed_repos;
                } else {
                    user_allowed_repos = user_allowances.split(',')
                                                        .map(part => part.trim());
                }

                allowed_repos_for_key = user_allowed_repos;
            }
        }
    }

    // Check each part against allowed_repos_for_key
    let all_parts_allowed = true;
    for (const part of url_parts)
        if (!allowed_repos_for_key.includes(part)) {
            all_parts_allowed = false;
        }

    return all_parts_allowed;
}

//endregion

/**
 * Method to call the majority of the methods above,
 * searching for the desired triggers, and forming a standard
 * struct to create a build-triggering comment with.
 * @param used_key {string} The owner of the key that was used
 * @param url {URL} The URL from Cloudflare built into a URL
 * object
 * @param payload {string} The body of the request from GitHub
 * @returns {Response|{}} error Response or object of trigger data
 */
function parse_trigger(used_key, url, payload) {
    // URL Parts
    let endpoint = url.pathname;
    let destination = get_url_parts(endpoint);
    if (destination.length < 1) {
        return new Response("{'error': 'Non-Permissible Trigger'}");
    }

    // URL parameters
    let getParams = {};
    for (const [key, value] of url.searchParams)
        getParams[key] = value;

    // Check Payload
    payload = JSON.parse(payload);
    if (!("repository" in payload)) {
        return new Response("{'error': 'Unexpected Request Body'}");
    }

    // Check payload if not enough data provided otherwise
    let main_and_test_not_set = !("test" in getParams) && !("main" in getParams);
    let branch = "";
    if (!("ref" in payload)) {
        if (main_and_test_not_set) {
            return new Response("{'error': 'No Branch Provided'}");
        } else {
            if ("test" in getParams) {
                branch = getParams["test"];
            }
            if ("main" in getParams) {
                branch = getParams["main"];
            }
        }
    } else {
        branch = payload["ref"].substring(payload["ref"].lastIndexOf('/') + 1);
    }

    // Build base trigger data
    let trigger = {
        worker_version: version,
        key_owner: used_key.charAt(0) + used_key.slice(1).toLowerCase(),
        target_repo: destination.join(','),
        target_name: "target_name" in getParams
            ? getParams["target_name"]
            : payload["repository"]["name"],
        branch_main: null,
        branch_test: null,
        code_repo: payload["repository"]["full_name"],
        code_private: payload["repository"]["private"],
        code_owner: payload["repository"]["owner"]["login"],
        code_url: payload["repository"]["html_url"],
        code_branch: branch,
    };

    // Build out additional trigger data
    // Get branch data
    if ("main" in getParams) {
        trigger["branch_main"] = getParams["main"];
    }
    if ("test" in getParams) {
        trigger["branch_test"] = getParams["test"];
    }
    // Fallback to make sure a branch is specified
    if (main_and_test_not_set) {
        trigger["branch_main"] = trigger["code_branch"];
    }
    // Add branch to name when not main or test (or main and test not set)
    let branch_not_main_or_test = trigger["branch_main"] !== trigger["code_branch"]
        && trigger["branch_main"] !== trigger["code_branch"];
    if (branch_not_main_or_test || main_and_test_not_set) {
        trigger["target_name"] = trigger["target_name"] + " (" + trigger["code_branch"] + ")";
    }

    return trigger;
}

/**
 * Method to create a comment on the AutoRepo repository to
 * trigger a build
 * @param trigger_data {{}} The data to create the comment
 * with, from parse_trigger()
 * @param env {{}} Environment Variables from worker request
 * @returns {Promise<Response|any>}
 */
async function post_comment_on_repo(trigger_data, env) {
    //region Create Comment on AutoRepo
    let comment_request = new Request(comment_url, {
        method: 'POST',
        headers: {
            'User-Agent': 'AutoRepo-Worker',
            'Accept': 'application/vnd.github+json',
            'Authorization': 'Bearer ' + env.Issue_Comment,
            'X-GitHub-Api-Version': '2022-11-28',
        }, body: JSON.stringify({
            body: "Build triggered by **_"
                + trigger_data.key_owner.split('__')[0]
                + "_**'s key for ["
                + trigger_data.code_repo + "]("
                + trigger_data.code_url + ")"
                + ":" + trigger_data.code_branch + ""
                + (trigger_data.code_private ? " (private)" : "")
                + ".\n\n"
                + "- **Target Name**: `" + trigger_data.target_name + "`\n"
                + "- **Target Repository**: `" + trigger_data.target_repo + "`\n"
                + "- **Main Branch**: `" + trigger_data.branch_main + "`\n"
                + (trigger_data.branch_test !== null
                    ? "- **Test Branch**: `" + trigger_data.branch_test + "`\n"
                    : "")
                + "\n\n\n"
                + "<details><summary>Raw Trigger Data</summary>"
                + "\n\n\n```json\n"
                + JSON.stringify(trigger_data, null, 4)
                + "\n```\n\n</details>"
                + "\n\n> (worker version: <kbd>" + trigger_data.worker_version + "</kbd>)"
        })
    });
    let comment_response = await fetch(comment_request);
    if (comment_response.status !== 201) {
        return new Response(
            "{'error': 'Broken GitHub Comment',"
            + "'errorDetails': '" + await comment_response.text() + "'}"
        );
    }

    return await comment_response.json();
}

async function handleRequest(request, env) {
    //todo: route autorepo.jsp.zbee.codes to the worker github
    //todo: route autorepo.jsp.zbee.codes/worker to the cloudflare

    //region Worker restrictions
    // Reject anything other than hookshot going to /trigger/
    if (!request.headers.get("user-agent") ||
        !request.headers.get("x-github-delivery") ||
        !request.headers.get("x-github-event") ||
        !request.headers.get("x-hub-signature-256") ||
        !request.headers.get("user-agent").startsWith("GitHub-Hookshot") ||
        !request.headers.get("x-hub-signature-256").startsWith("sha256=") ||
        request.url.indexOf("trigger") === -1) {
        return new Response("{'error': 'Non-Permissible Origin'}");
    }
    //endregion

    //region Key restrictions
    // Get valid Keys from AutoRepo's Variables
    let keys = await get_allowed_keys(env);
    if (keys instanceof Response) {
        return keys;
    }

    // Verify secrets sent against those from AutoRepo
    let payload = JSON.stringify(await request.json());
    let used_key = await verify_key(keys, request, payload);
    if (used_key instanceof Response) {
        return used_key;
    }
    //endregion

    //region Repository restrictions
    // Reject nonexistent repo options
    const url = new URL(request.url);
    const url_parts = get_url_parts(url.pathname);
    if (!repo_allowed(url_parts, keys)) {
        return new Response("{'error': 'Non-Permissible Repository'}");
    }

    // Check if the repo is allowed for the key
    if (!repo_allowed_for_key(url_parts, used_key, keys)) {
        return new Response(
            "{'error': 'Non-Permissible Repository for Key'," +
            "'key': '" + used_key + "'," +
            "'repos': '" + url_parts.join(', ') + "'}"
        );
    }
    //endregion

    // Parse request
    let trigger_data = parse_trigger(used_key, url, payload);
    if (trigger_data instanceof Response) {
        return trigger_data;
    }

    // todo: if repo is private, check if the bot has access to it

    // Create comment on AutoRepo
    let comment_response = await post_comment_on_repo(trigger_data, env);
    if (comment_response instanceof Response) {
        return comment_response;
    }
    trigger_data["github_comment_made"] = comment_response["html_url"];

    console.info(
        comment_response,
        trigger_data,
    );

    // Build response just for testing the worker
    let response = new Response(JSON.stringify(trigger_data, null, 4));

    // Set CORS headers
    response.headers.set(
        'Access-Control-Allow-Origin',
        request.headers.get('Origin')
    );
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
