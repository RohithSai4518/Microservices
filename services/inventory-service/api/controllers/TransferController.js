/**
 * TransferController - REST API Controller
 * Ingress request handlers with validation, service delegation, and JSON response formatting.
 */
class TransferController {
  constructor(service, options = {}) {
    this.service = service;
    this.options = options;
  }

  async handleGet(req, res) {
    try {
      const data = await this.service.execute({ query: req.query }, { traceId: res.traceId });
      res.json(data.getValue ? data.getValue() : data);
    } catch (err) {
      res.error(err);
    }
  }

  async handlePost(req, res) {
    try {
      const data = await this.service.execute(req.body, { traceId: res.traceId });
      res.status(201).json(data.getValue ? data.getValue() : data);
    } catch (err) {
      res.error(err);
    }
  }

  async handlePut(req, res) {
    try {
      const data = await this.service.execute({ ...req.body, id: req.params.id }, { traceId: res.traceId });
      res.json(data.getValue ? data.getValue() : data);
    } catch (err) {
      res.error(err);
    }
  }

  async handleDelete(req, res) {
    try {
      const data = await this.service.execute({ id: req.params.id, action: 'DELETE' }, { traceId: res.traceId });
      res.json({ success: true, id: req.params.id });
    } catch (err) {
      res.error(err);
    }
  }
}

module.exports = { TransferController };
