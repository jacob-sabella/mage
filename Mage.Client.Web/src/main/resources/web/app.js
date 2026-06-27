/*
 * XMage web client - front-end logic.
 * Talks to the gateway over REST (connect / tables / disconnect) and opens a
 * WebSocket for live server push (messages and game events).
 */
(() => {
    "use strict";

    const state = { token: null, server: null, ws: null };

    const $ = (id) => document.getElementById(id);

    // ----- views -----
    function showLogin() {
        $("view-login").classList.remove("hidden");
        $("view-lobby").classList.add("hidden");
        setConnStatus(false);
    }

    function showLobby() {
        $("view-login").classList.add("hidden");
        $("view-lobby").classList.remove("hidden");
        setConnStatus(true);
    }

    function setConnStatus(online) {
        const pill = $("conn-status");
        pill.textContent = online ? "Online" : "Offline";
        pill.classList.toggle("online", online);
        pill.classList.toggle("offline", !online);
    }

    function setLoginStatus(text, kind) {
        const el = $("login-status");
        el.textContent = text || "";
        el.classList.remove("error", "ok");
        if (kind) el.classList.add(kind);
    }

    // ----- API -----
    async function api(path, options) {
        const res = await fetch(path, Object.assign({ headers: { "Content-Type": "application/json" } }, options));
        let body = null;
        try { body = await res.json(); } catch (_) { /* empty */ }
        if (!res.ok) {
            const msg = body && body.error ? body.error : ("HTTP " + res.status);
            throw new Error(msg);
        }
        return body;
    }

    async function connect() {
        const host = $("host").value.trim();
        const port = parseInt($("port").value.trim(), 10);
        const username = $("username").value.trim();

        if (!host || !username) { setLoginStatus("Server and display name are required.", "error"); return; }
        if (Number.isNaN(port)) { setLoginStatus("Port must be a number.", "error"); return; }

        const btn = $("connect-btn");
        btn.disabled = true; btn.textContent = "Connecting…";
        setLoginStatus("Connecting to " + host + ":" + port + " …", null);

        try {
            const res = await api("/api/connect", {
                method: "POST",
                body: JSON.stringify({ host, port, username })
            });
            state.token = res.token;
            state.server = res.server;
            openSocket();
            showLobby();
            refreshTables();
        } catch (e) {
            setLoginStatus("Could not connect: " + e.message, "error");
        } finally {
            btn.disabled = false; btn.textContent = "Connect";
        }
    }

    async function refreshTables() {
        const btn = $("refresh-btn");
        btn.disabled = true; btn.textContent = "Refreshing…";
        try {
            const tables = await api("/api/tables?token=" + encodeURIComponent(state.token));
            renderTables(tables || []);
        } catch (e) {
            logEvent("error", e.message);
        } finally {
            btn.disabled = false; btn.textContent = "Refresh";
        }
    }

    async function disconnect() {
        if (state.ws) { try { state.ws.close(); } catch (_) {} state.ws = null; }
        try {
            await api("/api/disconnect", { method: "POST", body: JSON.stringify({ token: state.token }) });
        } catch (_) { /* ignore */ }
        state.token = null;
        showLogin();
        setLoginStatus("Disconnected.", "ok");
    }

    // ----- rendering -----
    function renderTables(tables) {
        const body = $("tables-body");
        body.innerHTML = "";
        $("table-count").textContent = tables.length + (tables.length === 1 ? " table" : " tables");
        $("tables-empty").classList.toggle("hidden", tables.length > 0);

        for (const t of tables) {
            const tr = document.createElement("tr");
            tr.appendChild(cell(t.name));
            tr.appendChild(cell(t.gameType));
            tr.appendChild(cell(t.controller));
            tr.appendChild(cell(t.seats));
            tr.appendChild(cell(t.state));
            body.appendChild(tr);
        }
    }

    function cell(text) {
        const td = document.createElement("td");
        td.textContent = text == null ? "" : text;
        return td;
    }

    // ----- websocket -----
    function openSocket() {
        const proto = location.protocol === "https:" ? "wss" : "ws";
        const url = proto + "://" + location.host + "/ws?token=" + encodeURIComponent(state.token);
        const ws = new WebSocket(url);
        state.ws = ws;
        ws.onmessage = (ev) => {
            try {
                const msg = JSON.parse(ev.data);
                logEvent(msg.type, msg.payload);
                // a server-side change is a good cue to refresh the lobby
                if (msg.type === "event") refreshTables();
            } catch (_) { /* ignore non-JSON frames */ }
        };
        ws.onclose = () => { if (state.token) setConnStatus(false); };
    }

    function logEvent(tag, payload) {
        const log = $("event-log");
        const line = document.createElement("div");
        line.className = "line";
        const t = document.createElement("span");
        t.className = "tag";
        t.textContent = "[" + tag + "] ";
        line.appendChild(t);
        line.appendChild(document.createTextNode(payload == null ? "" : payload));
        log.appendChild(line);
        log.scrollTop = log.scrollHeight;
        while (log.childNodes.length > 100) log.removeChild(log.firstChild);
    }

    // ----- wire up -----
    window.addEventListener("DOMContentLoaded", () => {
        $("connect-btn").addEventListener("click", connect);
        $("refresh-btn").addEventListener("click", refreshTables);
        $("disconnect-btn").addEventListener("click", disconnect);
        $("username").addEventListener("keydown", (e) => { if (e.key === "Enter") connect(); });
        showLogin();
    });
})();
