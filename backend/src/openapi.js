export function buildOpenApiSpec() {
  const host = process.env.APP_HOST || 'localhost:8080';
  const protocol = process.env.APP_PROTOCOL || 'http';
  const bearer = [{ bearerAuth: [] }];
  const json = { 'application/json': { schema: { type: 'object' } } };
  const response = (description, content) => ({ description, ...(content ? { content } : {}) });
  return {
    openapi: '3.1.0',
    info: {
      title: 'Fahrtenbuch API',
      version: '1.0.0',
      description: 'REST-API für Web- und Android-Clients. Access-Token werden als Bearer-Token gesendet.',
    },
    servers: [{ url: `${protocol}://${host}/api/v1`, description: 'Konfigurierter Server' }, { url: '/api/v1', description: 'Relativ zum aktuellen Host' }],
    tags: [
      { name: 'System' }, { name: 'Auth' }, { name: 'Profile' },
        { name: 'App Pairing' }, { name: 'Vehicles' },
      { name: 'Trips' }, { name: 'Tracking' }, { name: 'Tags' }, { name: 'Map' },
      { name: 'Geocoding' }, { name: 'Statistics' }, { name: 'Import/Export' }, { name: 'Admin' },
    ],
    components: {
      securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } },
      schemas: {
        Login: { type: 'object', required: ['email', 'password'], properties: { email: { type: 'string', format: 'email' }, password: { type: 'string', format: 'password' }, totpCode: { type: 'string', pattern: '^\\d{6}$' }, deviceName: { type: 'string' } } },
        TokenPair: { type: 'object', properties: { accessToken: { type: 'string' }, refreshToken: { type: 'string' }, tokenType: { type: 'string', example: 'Bearer' }, expiresIn: { type: 'integer' }, user: { $ref: '#/components/schemas/User' } } },
        User: { type: 'object', properties: { id: { type: 'string', format: 'uuid' }, email: { type: 'string', format: 'email' }, displayName: { type: 'string' }, role: { type: 'string', enum: ['admin', 'user'] }, isActive: { type: 'boolean' } } },
        Vehicle: { type: 'object', required: ['name'], properties: { id: { type: 'string', format: 'uuid' }, name: { type: 'string' }, licensePlate: { type: ['string', 'null'] }, btMac: { type: ['string', 'null'], pattern: '^[0-9A-F]{2}(:[0-9A-F]{2}){5}$', example: 'AA:BB:CC:DD:EE:FF' }, btMacUpdatedAt: { type: ['string', 'null'], format: 'date-time' } } },
        Trip: { type: 'object', properties: { id: { type: 'string', format: 'uuid' }, vehicleId: { type: 'string', format: 'uuid' }, tripType: { type: 'string', enum: ['commute', 'private', 'business'] }, startedAt: { type: 'string', format: 'date-time' }, endedAt: { type: ['string', 'null'], format: 'date-time' }, startLocation: { type: 'string' }, destinationLocation: { type: 'string' }, distanceKm: { type: ['number', 'null'] }, tags: { type: 'array', items: { type: 'string' } } } },
        Point: { type: 'object', required: ['recordedAt', 'latitude', 'longitude', 'sequenceNumber'], properties: { recordedAt: { type: 'string', format: 'date-time' }, latitude: { type: 'number' }, longitude: { type: 'number' }, altitudeM: { type: ['number', 'null'] }, speedKmh: { type: ['number', 'null'] }, accuracyM: { type: ['number', 'null'] }, sequenceNumber: { type: 'integer', minimum: 0 } } },
        Error: { type: 'object', properties: { error: { type: 'string' } } },
      },
    },
    paths: {
      '/health': { get: { tags: ['System'], summary: 'Systemstatus', responses: { 200: response('OK', json) } } },
      '/auth/login': { post: { tags: ['Auth'], summary: 'Login mit E-Mail, Passwort und optional TOTP', requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/Login' } } } }, responses: { 200: response('Tokenpaar', { 'application/json': { schema: { $ref: '#/components/schemas/TokenPair' } } }), 401: response('Ungültige Anmeldung') } } },
      '/auth/passkey/options': { post: { tags: ['Auth'], summary: 'Optionen für passwortlosen Passkey-Login', responses: { 200: response('WebAuthn-Optionen', json) } } },
      '/auth/passkey/verify': { post: { tags: ['Auth'], summary: 'Passkey-Anmeldung bestätigen', requestBody: { required: true, content: json }, responses: { 200: response('Tokenpaar', { 'application/json': { schema: { $ref: '#/components/schemas/TokenPair' } } }) } } },
      '/auth/pair/options': { post: { tags: ['App Pairing'], security: bearer, summary: 'Kurzlebigen QR-Pairing-Code erzeugen', requestBody: { content: json }, responses: { 201: response('Pairing-Code mit QR-Code', json) } } },
      '/auth/pair': { post: { tags: ['App Pairing'], summary: 'Mobile App mit Pairing-Code anmelden', requestBody: { required: true, content: json }, responses: { 200: response('Tokenpaar und Gerät', json), 410: response('Code abgelaufen') } } },
      '/auth/pair/{pairId}/status': { get: { tags: ['App Pairing'], security: bearer, summary: 'Pairing-Status abfragen', parameters: [{ name:'pairId',in:'path',required:true,schema:{type:'string',format:'uuid'} }], responses:{200:response('Status',json)} }, delete: { tags: ['App Pairing'], security: bearer, summary: 'Pairing-Code abbrechen', parameters: [{ name:'pairId',in:'path',required:true,schema:{type:'string',format:'uuid'} }], responses:{204:response('Abgebrochen')} } },
      '/auth/refresh': { post: { tags: ['Auth'], summary: 'Access-Token erneuern', requestBody: { required: true, content: json }, responses: { 200: response('Neues Tokenpaar', json) } } },
      '/auth/logout': { post: { tags: ['Auth'], summary: 'Refresh-Token widerrufen', requestBody: { content: json }, responses: { 204: response('Abgemeldet') } } },
      '/auth/forgot-password': { post: { tags: ['Auth'], summary: 'Passwort-Reset anfordern', requestBody: { required: true, content: json }, responses: { 200: response('Anfrage angenommen', json) } } },
      '/auth/reset-password': { post: { tags: ['Auth'], summary: 'Passwort zurücksetzen', requestBody: { required: true, content: json }, responses: { 200: response('Passwort geändert', json) } } },
      '/users/me': { get: { tags: ['Profile'], security: bearer, summary: 'Eigenes Profil', responses: { 200: response('Profil', { 'application/json': { schema: { $ref: '#/components/schemas/User' } } }) } }, put: { tags: ['Profile'], security: bearer, summary: 'Eigenes Profil ändern', requestBody: { required: true, content: json }, responses: { 200: response('Profil', json) } } },
      '/users/me/devices': { get: { tags: ['App Pairing'], security: bearer, summary: 'Verbundene Geräte auflisten', responses: { 200: response('Geräte', json) } } },
      '/users/me/devices/{deviceId}': { delete: { tags: ['App Pairing'], security: bearer, summary: 'Alle Sitzungen eines Geräts widerrufen', parameters: [{ name:'deviceId',in:'path',required:true,schema:{type:'string'} }], responses:{204:response('Gerät abgemeldet')} } },
      '/users/me/sessions': { get: { tags: ['Profile'], security: bearer, summary: 'Aktive App-Sitzungen', responses: { 200: response('Sitzungen', json) } } },
      '/users/me/sessions/{id}': { delete: { tags: ['Profile'], security: bearer, summary: 'Sitzung widerrufen', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }], responses: { 204: response('Widerrufen') } } },
      '/vehicles': { get: { tags: ['Vehicles'], security: bearer, summary: 'Fahrzeuge auflisten', responses: { 200: response('Fahrzeuge', { 'application/json': { schema: { type: 'array', items: { $ref: '#/components/schemas/Vehicle' } } } }) } }, post: { tags: ['Vehicles'], security: bearer, summary: 'Fahrzeug anlegen', requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/Vehicle' } } } }, responses: { 201: response('Angelegt', json) } } },
      '/vehicles/{id}': { get: { tags: ['Vehicles'], security: bearer, summary: 'Fahrzeug laden', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }], responses: { 200: response('Fahrzeug', json) } }, put: { tags: ['Vehicles'], security: bearer, summary: 'Fahrzeug ändern', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }], requestBody: { required: true, content: json }, responses: { 200: response('Geändert', json) } }, delete: { tags: ['Vehicles'], security: bearer, summary: 'Fahrzeug löschen', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }], responses: { 204: response('Gelöscht') } } },
      '/vehicles/{id}/bluetooth': { put: { tags: ['Vehicles'], security: bearer, summary: 'Bluetooth-MAC durch eine App setzen oder entfernen', description: 'Alle App-Instanzen desselben Benutzers erhalten die gespeicherte MAC über die Fahrzeug-Endpunkte.', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }], requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['btMac'], properties: { btMac: { type: ['string', 'null'], example: 'AA:BB:CC:DD:EE:FF' } } } } } }, responses: { 200: response('Fahrzeug aktualisiert', json), 409: response('MAC bereits vergeben') } } },
      '/trips': { get: { tags: ['Trips'], security: bearer, summary: 'Fahrten mit Filtern auflisten', parameters: ['vehicleId','from','to','type','tag'].map(name => ({ name, in: 'query', schema: { type: 'string' } })), responses: { 200: response('Fahrten', json) } }, post: { tags: ['Trips'], security: bearer, summary: 'Fahrt anlegen', requestBody: { required: true, content: json }, responses: { 201: response('Angelegt', json) } } },
      '/trips/{id}': { get: { tags: ['Trips'], security: bearer, summary: 'Fahrt laden', parameters: [{ name:'id',in:'path',required:true,schema:{type:'string',format:'uuid'} }], responses:{200:response('Fahrt',json)} }, put: { tags:['Trips'],security:bearer,summary:'Fahrt ändern',parameters:[{name:'id',in:'path',required:true,schema:{type:'string',format:'uuid'}}],requestBody:{required:true,content:json},responses:{200:response('Geändert',json)} }, delete: { tags:['Trips'],security:bearer,summary:'Fahrt löschen',parameters:[{name:'id',in:'path',required:true,schema:{type:'string',format:'uuid'}}],responses:{204:response('Gelöscht')} } },
      '/tracking/start': { post: { tags:['Tracking'],security:bearer,summary:'GPS-Aufzeichnung starten',requestBody:{required:true,content:json},responses:{201:response('Gestartete Fahrt',json)} } },
      '/tracking/{tripId}/points': { post: { tags:['Tracking'],security:bearer,summary:'GPS-Punkte stapelweise speichern',parameters:[{name:'tripId',in:'path',required:true,schema:{type:'string',format:'uuid'}}],requestBody:{required:true,content:{'application/json':{schema:{type:'object',properties:{points:{type:'array',maxItems:5000,items:{$ref:'#/components/schemas/Point'}}}}}}},responses:{201:response('Gespeichert',json)} } },
      '/tracking/{tripId}/stop': { post: { tags:['Tracking'],security:bearer,summary:'GPS-Aufzeichnung beenden',parameters:[{name:'tripId',in:'path',required:true,schema:{type:'string',format:'uuid'}}],requestBody:{content:json},responses:{200:response('Beendete Fahrt',json)} } },
      '/tracking/{tripId}': { get: { tags:['Tracking'],security:bearer,summary:'Route und Fahrt laden',parameters:[{name:'tripId',in:'path',required:true,schema:{type:'string',format:'uuid'}}],responses:{200:response('Trackingdaten',json)} } },
      '/tags': { get: { tags:['Tags'],security:bearer,summary:'Tags auflisten',responses:{200:response('Tags',json)} }, post: { tags:['Tags'],security:bearer,summary:'Tag anlegen',requestBody:{required:true,content:json},responses:{201:response('Tag',json)} } },
      '/tags/{id}': { put: { tags:['Tags'],security:bearer,summary:'Tag ändern',parameters:[{name:'id',in:'path',required:true,schema:{type:'string',format:'uuid'}}],requestBody:{required:true,content:json},responses:{200:response('Tag',json)} }, delete: { tags:['Tags'],security:bearer,summary:'Tag löschen',parameters:[{name:'id',in:'path',required:true,schema:{type:'string',format:'uuid'}}],responses:{204:response('Gelöscht')} } },
      '/map/trips': { get: { tags:['Map'],security:bearer,summary:'Fahrten für Kartenübersicht',responses:{200:response('Kartendaten',json)} } },
      '/map/trips/{tripId}': { get: { tags:['Map'],security:bearer,summary:'Route einer Fahrt',parameters:[{name:'tripId',in:'path',required:true,schema:{type:'string',format:'uuid'}}],responses:{200:response('Route',json)} } },
      '/geocoding/search': { get: { tags:['Geocoding'],security:bearer,summary:'Ort über Photon suchen',parameters:[{name:'q',in:'query',required:true,schema:{type:'string'}}],responses:{200:response('Photon-Ergebnis',json)} } },
      '/geocoding/reverse': { get: { tags:['Geocoding'],security:bearer,summary:'Koordinaten rückwärts geokodieren',parameters:[{name:'lat',in:'query',required:true,schema:{type:'number'}},{name:'lon',in:'query',required:true,schema:{type:'number'}}],responses:{200:response('Photon-Ergebnis',json)} } },
      '/statistics': { get: { tags:['Statistics'],security:bearer,summary:'Gesamtstatistik',responses:{200:response('Statistik',json)} } },
      '/settings': { get: { tags:['Profile'],security:bearer,summary:'Einstellungen laden',responses:{200:response('Einstellungen',json)} }, put: { tags:['Profile'],security:bearer,summary:'Einstellungen speichern',requestBody:{required:true,content:json},responses:{200:response('Einstellungen',json)} } },
      '/export': { get: { tags:['Import/Export'],security:bearer,summary:'Eigene Daten exportieren',responses:{200:response('Export',json)} } },
      '/import': { post: { tags:['Import/Export'],security:bearer,summary:'Daten importieren',requestBody:{required:true,content:json},responses:{201:response('Importiert',json)} } },
      '/admin/users': { get: { tags:['Admin'],security:bearer,summary:'Benutzer auflisten',responses:{200:response('Benutzer',json)} }, post: { tags:['Admin'],security:bearer,summary:'Benutzer anlegen',requestBody:{required:true,content:json},responses:{201:response('Benutzer',json)} } },
      '/admin/users/{id}': { put: { tags:['Admin'],security:bearer,summary:'Benutzer ändern',parameters:[{name:'id',in:'path',required:true,schema:{type:'string',format:'uuid'}}],requestBody:{required:true,content:json},responses:{200:response('Benutzer',json)} }, delete: { tags:['Admin'],security:bearer,summary:'Benutzer löschen',parameters:[{name:'id',in:'path',required:true,schema:{type:'string',format:'uuid'}}],responses:{204:response('Gelöscht')} } },
    },
  };
}
