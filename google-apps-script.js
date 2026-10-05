const YHORS_TOKEN = 'CAMBIA_ESTE_TOKEN';

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents || '{}');
    if (!body || body.token !== YHORS_TOKEN) {
      return ContentService.createTextOutput(JSON.stringify({ ok: false, error: 'Unauthorized' }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    if (!body.to || !body.subject || !body.html) {
      return ContentService.createTextOutput(JSON.stringify({ ok: false, error: 'Missing fields' }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    const options = {
      htmlBody: body.html,
      name: body.name || 'YHORS STORE'
    };
    if (body.bcc) options.bcc = body.bcc;

    MailApp.sendEmail(body.to, body.subject, body.text || 'Tu pedido fue recibido correctamente.', options);

    return ContentService.createTextOutput(JSON.stringify({ ok: true }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (error) {
    return ContentService.createTextOutput(JSON.stringify({ ok: false, error: String(error) }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}
