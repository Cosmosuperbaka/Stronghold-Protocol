// Minimal Cache Storage model with the same ownership/clone behavior used by browsers.
export function resourceCaches() {
  const stores = new Map();
  return {
    async keys() { return [...stores.keys()]; },
    async delete(name) { return stores.delete(name); },
    async open(name) {
      if (!stores.has(name)) stores.set(name, new Map());
      const entries = stores.get(name), key = request => typeof request === 'string' ? request : request.url;
      return {
        async match(request) { return entries.get(key(request))?.clone(); },
        async put(request, response) { entries.set(key(request), new Response(await response.arrayBuffer(), { headers: response.headers, status: response.status })); },
        async delete(request) { return entries.delete(key(request)); },
        async keys() { return [...entries.keys()].map(url => new Request(url)); },
      };
    },
  };
}
