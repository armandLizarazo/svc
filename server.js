// server.js
// Import necessary modules
const express = require("express");
const sqlite3 = require("sqlite3").verbose();
const cors = require("cors");

const app = express();
const PORT = 3001;

// --- Middleware ---
app.use(cors());
app.use(express.json());

// --- Database Setup ---
const dbPath = "./ventas_credito.db";
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error("Error connecting to database:", err.message);
  } else {
    console.log(
      "Successfully connected to the SQLite database 'ventas_credito.db'"
    );
    initializeDatabase();
  }
});

// Function to create/update database tables
function initializeDatabase() {
  const createClientesTable = `
        CREATE TABLE IF NOT EXISTS clientes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            nombre TEXT NOT NULL,
            identificacion TEXT UNIQUE,
            telefono TEXT,
            email TEXT
        );`;
  const createVentasTable = `
        CREATE TABLE IF NOT EXISTS ventas (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            clienteId INTEGER NOT NULL,
            producto TEXT NOT NULL,
            monto REAL NOT NULL,
            fecha TEXT NOT NULL,
            estado TEXT NOT NULL DEFAULT 'Pendiente',
            FOREIGN KEY (clienteId) REFERENCES clientes (id) ON DELETE CASCADE
        );`;

  const createApartadosTable = `
        CREATE TABLE IF NOT EXISTS apartados (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            clienteId INTEGER NOT NULL,
            producto TEXT NOT NULL,
            montoTotal REAL NOT NULL,
            fechaCreacion TEXT NOT NULL,
            estadoApartado TEXT NOT NULL DEFAULT 'Apartado', 
            fechaEntrega TEXT,
            FOREIGN KEY (clienteId) REFERENCES clientes (id) ON DELETE CASCADE
        );`;

  const createAbonosTable = `
        CREATE TABLE IF NOT EXISTS abonos (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            ventaId INTEGER, 
            apartadoId INTEGER, 
            monto REAL NOT NULL,
            fecha TEXT NOT NULL,
            comentarios TEXT,
            FOREIGN KEY (ventaId) REFERENCES ventas (id) ON DELETE CASCADE,
            FOREIGN KEY (apartadoId) REFERENCES apartados (id) ON DELETE CASCADE,
            CONSTRAINT chk_abono_referencia CHECK (
                (ventaId IS NOT NULL AND apartadoId IS NULL) OR
                (ventaId IS NULL AND apartadoId IS NOT NULL)
            )
        );`;

  db.serialize(() => {
    db.run(createClientesTable, (err) => handleDbError(err, "clientes table"));
    db.run(createVentasTable, (err) => handleDbError(err, "ventas table"));
    db.run(createApartadosTable, (err) =>
      handleDbError(err, "apartados table")
    );

    db.run(createAbonosTable, (err) => {
      if (err) {
        if (!err.message.includes("table abonos already exists")) {
          console.warn(
            "CREATE TABLE IF NOT EXISTS abonos reported an issue:",
            err.message
          );
        } else {
          console.log("'abonos' table already exists. Checking columns.");
        }
      } else {
        console.log(
          "'abonos' table created successfully or already existed with the correct schema."
        );
      }

      const alterAbonosAddApartadoId =
        "ALTER TABLE abonos ADD COLUMN apartadoId INTEGER REFERENCES apartados(id) ON DELETE CASCADE";
      db.run(alterAbonosAddApartadoId, (alterErr) => {
        if (alterErr && !alterErr.message.includes("duplicate column name"))
          console.error(
            "Error adding 'apartadoId' to 'abonos':",
            alterErr.message
          );
        else if (!alterErr)
          console.log("'apartadoId' column added to 'abonos'.");
      });

      const alterAbonosAddComentarios =
        "ALTER TABLE abonos ADD COLUMN comentarios TEXT";
      db.run(alterAbonosAddComentarios, (alterErr) => {
        if (alterErr && !alterErr.message.includes("duplicate column name"))
          console.error(
            "Error adding 'comentarios' to 'abonos':",
            alterErr.message
          );
        else if (!alterErr)
          console.log("'comentarios' column added to 'abonos'.");
      });
    });
    console.log("Database tables check/creation/update process completed.");
  });
}

function handleDbError(err, tableName) {
  if (err) {
    console.error(`Database error during ${tableName} creation:`, err.message);
  }
}

// --- API Routes (Endpoints) ---

// == Clientes ==
app.get("/api/clientes", (req, res) => {
  /* ... (no change) ... */
  const sql = "SELECT * FROM clientes ORDER BY nombre ASC";
  db.all(sql, [], (err, rows) => {
    if (err)
      res.status(500).json({ error: "Error fetching clients: " + err.message });
    else res.json(rows);
  });
});
app.post("/api/clientes", (req, res) => {
  /* ... (no change) ... */
  const { nombre, identificacion, telefono, email } = req.body;
  if (!nombre)
    return res.status(400).json({ error: "Client name is required." });
  const sql =
    "INSERT INTO clientes (nombre, identificacion, telefono, email) VALUES (?, ?, ?, ?)";
  db.run(sql, [nombre, identificacion, telefono, email], function (err) {
    if (err) {
      if (err.message.includes("UNIQUE constraint failed"))
        return res.status(400).json({
          error: `Client identification '${identificacion}' already exists.`,
        });
      res.status(500).json({ error: "Error adding client: " + err.message });
    } else res.status(201).json({ id: this.lastID, nombre, identificacion, telefono, email });
  });
});

// PUT /api/clientes/:id - Update client's phone or email
app.put("/api/clientes/:id", (req, res) => {
  const clienteId = req.params.id;
  const { telefono, email } = req.body;

  if (telefono === undefined && email === undefined) {
    return res.status(400).json({
      error: "Debe proporcionar al menos un teléfono o email para actualizar.",
    });
  }

  let fieldsToUpdate = [];
  let params = [];

  if (telefono !== undefined) {
    fieldsToUpdate.push("telefono = ?");
    params.push(telefono);
  }
  if (email !== undefined) {
    fieldsToUpdate.push("email = ?");
    params.push(email);
  }

  if (fieldsToUpdate.length === 0) {
    // Should be caught by the check above, but as a safeguard
    return res.status(400).json({ error: "No fields provided for update." });
  }

  params.push(clienteId); // Add ID for the WHERE clause

  const sql = `UPDATE clientes SET ${fieldsToUpdate.join(", ")} WHERE id = ?`;

  db.run(sql, params, function (err) {
    if (err) {
      return res
        .status(500)
        .json({ error: "Error actualizando cliente: " + err.message });
    }
    if (this.changes === 0) {
      return res.status(404).json({ error: "Cliente no encontrado." });
    }
    // Fetch and return the updated client
    db.get("SELECT * FROM clientes WHERE id = ?", [clienteId], (err, row) => {
      if (err)
        return res.status(500).json({
          error: "Error obteniendo cliente actualizado: " + err.message,
        });
      res.json(row);
    });
  });
});

// == Ventas ==
app.get("/api/ventas", (req, res) => {
  /* ... (no change) ... */
  const sql = `
        SELECT
            v.id, v.clienteId, v.producto, v.monto, v.fecha, v.estado,
            c.nombre as nombreCliente,
            IFNULL(SUM(a.monto), 0) as totalAbonado,
            (v.monto - IFNULL(SUM(a.monto), 0)) as saldoPendiente
        FROM ventas v
        JOIN clientes c ON v.clienteId = c.id
        LEFT JOIN abonos a ON v.id = a.ventaId 
        GROUP BY v.id
        ORDER BY v.fecha DESC, v.id DESC;`;
  db.all(sql, [], (err, rows) => {
    if (err)
      return res
        .status(500)
        .json({ error: "Error fetching sales: " + err.message });
    const ventasActualizadas = rows.map((venta) => ({
      ...venta,
      estado: venta.saldoPendiente <= 0.001 ? "Pagada" : "Pendiente",
    }));
    ventasActualizadas.forEach((v) => {
      const updateStatusSQL =
        "UPDATE ventas SET estado = ? WHERE id = ? AND estado != ?";
      if (v.estado === "Pagada")
        db.run(updateStatusSQL, ["Pagada", v.id, "Pagada"]);
      else db.run(updateStatusSQL, ["Pendiente", v.id, "Pendiente"]);
    });
    res.json(ventasActualizadas);
  });
});
app.post("/api/ventas", (req, res) => {
  /* ... (no change) ... */
  const { clienteId, producto, monto, fecha } = req.body;
  if (!clienteId || !producto || monto === undefined || !fecha)
    return res.status(400).json({ error: "Missing required fields for sale." });
  if (isNaN(parseFloat(monto)) || parseFloat(monto) <= 0)
    return res
      .status(400)
      .json({ error: "Sale amount must be a positive number." });
  const sql =
    "INSERT INTO ventas (clienteId, producto, monto, fecha, estado) VALUES (?, ?, ?, ?, ?)";
  db.run(
    sql,
    [clienteId, producto, parseFloat(monto), fecha, "Pendiente"],
    function (err) {
      if (err)
        return res
          .status(500)
          .json({ error: "Error adding sale: " + err.message });
      res.status(201).json({
        id: this.lastID,
        clienteId,
        producto,
        monto: parseFloat(monto),
        fecha,
        estado: "Pendiente",
        totalAbonado: 0,
        saldoPendiente: parseFloat(monto),
      });
    }
  );
});

// PUT /api/ventas/:id/fecha - Update sale date
app.put("/api/ventas/:id/fecha", (req, res) => {
  const ventaId = req.params.id;
  const { fecha } = req.body;

  if (!fecha) {
    return res.status(400).json({ error: "La fecha es requerida." });
  }
  // Basic date validation (YYYY-MM-DD) - can be more robust
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
    return res
      .status(400)
      .json({ error: "Formato de fecha inválido. Use YYYY-MM-DD." });
  }

  const sql = "UPDATE ventas SET fecha = ? WHERE id = ?";
  db.run(sql, [fecha, ventaId], function (err) {
    if (err) {
      return res.status(500).json({
        error: "Error actualizando fecha de la venta: " + err.message,
      });
    }
    if (this.changes === 0) {
      return res.status(404).json({ error: "Venta no encontrada." });
    }
    res.json({ message: "Fecha de venta actualizada.", id: ventaId, fecha });
  });
});

// DELETE /api/ventas/:id - Delete a sale
app.delete("/api/ventas/:id", (req, res) => {
  const ventaId = req.params.id;
  // ON DELETE CASCADE on abonos.ventaId should handle deleting associated payments
  const sql = "DELETE FROM ventas WHERE id = ?";
  db.run(sql, [ventaId], function (err) {
    if (err) {
      return res
        .status(500)
        .json({ error: "Error eliminando venta: " + err.message });
    }
    if (this.changes === 0) {
      return res.status(404).json({ error: "Venta no encontrada." });
    }
    res.json({ message: `Venta #${ventaId} eliminada exitosamente.` });
  });
});

// == Apartados ==
app.post("/api/apartados", (req, res) => {
  /* ... (no change) ... */
  const { clienteId, producto, montoTotal, fechaCreacion } = req.body;
  if (!clienteId || !producto || montoTotal === undefined) {
    return res.status(400).json({
      error:
        "Missing required fields for apartado (clienteId, producto, montoTotal).",
    });
  }
  if (isNaN(parseFloat(montoTotal)) || parseFloat(montoTotal) <= 0) {
    return res
      .status(400)
      .json({ error: "Apartado amount must be a positive number." });
  }
  const fecha = fechaCreacion || new Date().toISOString().split("T")[0];
  const estadoInicial = "Apartado";

  const sql =
    "INSERT INTO apartados (clienteId, producto, montoTotal, fechaCreacion, estadoApartado) VALUES (?, ?, ?, ?, ?)";
  db.run(
    sql,
    [clienteId, producto, parseFloat(montoTotal), fecha, estadoInicial],
    function (err) {
      if (err) {
        return res
          .status(500)
          .json({ error: "Error creating apartado: " + err.message });
      }
      res.status(201).json({
        id: this.lastID,
        clienteId,
        producto,
        montoTotal: parseFloat(montoTotal),
        fechaCreacion: fecha,
        estadoApartado: estadoInicial,
        totalAbonado: 0,
        saldoPendiente: parseFloat(montoTotal),
      });
    }
  );
});
app.get("/api/apartados", (req, res) => {
  /* ... (no change) ... */
  const sql = `
        SELECT
            ap.id, ap.clienteId, ap.producto, ap.montoTotal, ap.fechaCreacion, ap.estadoApartado, ap.fechaEntrega,
            c.nombre as nombreCliente,
            IFNULL(SUM(ab.monto), 0) as totalAbonado,
            (ap.montoTotal - IFNULL(SUM(ab.monto), 0)) as saldoPendiente
        FROM apartados ap
        JOIN clientes c ON ap.clienteId = c.id
        LEFT JOIN abonos ab ON ap.id = ab.apartadoId 
        GROUP BY ap.id
        ORDER BY ap.fechaCreacion DESC, ap.id DESC;
    `;
  db.all(sql, [], (err, rows) => {
    if (err)
      return res
        .status(500)
        .json({ error: "Error fetching apartados: " + err.message });

    const apartadosActualizados = rows.map((apartado) => {
      let nuevoEstado = apartado.estadoApartado;
      if (
        apartado.estadoApartado === "Apartado" &&
        apartado.saldoPendiente <= 0.001
      ) {
        nuevoEstado = "Pagado";
      }
      return { ...apartado, estadoApartado: nuevoEstado };
    });

    apartadosActualizados.forEach((ap) => {
      if (
        ap.estadoApartado === "Pagado" &&
        ap.estadoApartado !== rows.find((r) => r.id === ap.id)?.estadoApartado
      ) {
        db.run(
          "UPDATE apartados SET estadoApartado = 'Pagado' WHERE id = ? AND estadoApartado = 'Apartado'",
          [ap.id]
        );
      }
    });
    res.json(apartadosActualizados);
  });
});
app.put("/api/apartados/:id/entregar", (req, res) => {
  /* ... (no change) ... */
  const apartadoId = req.params.id;
  const fechaEntrega = new Date().toISOString().split("T")[0];
  const sql =
    "UPDATE apartados SET estadoApartado = 'Entregado', fechaEntrega = ? WHERE id = ? AND estadoApartado = 'Pagado'";

  db.run(sql, [fechaEntrega, apartadoId], function (err) {
    if (err)
      return res
        .status(500)
        .json({ error: "Error marking apartado as delivered: " + err.message });
    if (this.changes === 0) {
      db.get(
        "SELECT estadoApartado FROM apartados WHERE id = ?",
        [apartadoId],
        (err, row) => {
          if (row && row.estadoApartado !== "Pagado") {
            return res.status(400).json({
              error: `Apartado no está en estado 'Pagado'. Estado actual: ${row.estadoApartado}`,
            });
          }
          return res
            .status(404)
            .json({ error: "Apartado not found or not in 'Pagado' state." });
        }
      );
    } else {
      res.json({
        message: "Apartado marcado como Entregado.",
        id: apartadoId,
        fechaEntrega,
        estadoApartado: "Entregado",
      });
    }
  });
});
app.put("/api/apartados/:id/cancelar", (req, res) => {
  /* ... (no change) ... */
  const apartadoId = req.params.id;
  const sql =
    "UPDATE apartados SET estadoApartado = 'Cancelado' WHERE id = ? AND estadoApartado IN ('Apartado', 'Pagado')";
  db.run(sql, [apartadoId], function (err) {
    if (err)
      return res
        .status(500)
        .json({ error: "Error cancelling apartado: " + err.message });
    if (this.changes === 0) {
      return res.status(400).json({
        error:
          "Apartado no encontrado o no se puede cancelar (ej. ya entregado).",
      });
    }
    res.json({
      message: "Apartado cancelado.",
      id: apartadoId,
      estadoApartado: "Cancelado",
    });
  });
});

// PUT /api/apartados/:id/fecha - Update layaway creation date
app.put("/api/apartados/:id/fecha", (req, res) => {
  const apartadoId = req.params.id;
  const { fechaCreacion } = req.body;

  if (!fechaCreacion) {
    return res
      .status(400)
      .json({ error: "La fecha de creación es requerida." });
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fechaCreacion)) {
    return res
      .status(400)
      .json({ error: "Formato de fecha inválido. Use YYYY-MM-DD." });
  }

  const sql = "UPDATE apartados SET fechaCreacion = ? WHERE id = ?";
  db.run(sql, [fechaCreacion, apartadoId], function (err) {
    if (err) {
      return res.status(500).json({
        error:
          "Error actualizando fecha de creación del apartado: " + err.message,
      });
    }
    if (this.changes === 0) {
      return res.status(404).json({ error: "Apartado no encontrado." });
    }
    res.json({
      message: "Fecha de creación del apartado actualizada.",
      id: apartadoId,
      fechaCreacion,
    });
  });
});

// DELETE /api/apartados/:id - Delete a layaway
app.delete("/api/apartados/:id", (req, res) => {
  const apartadoId = req.params.id;
  // ON DELETE CASCADE on abonos.apartadoId should handle deleting associated payments
  const sql = "DELETE FROM apartados WHERE id = ?";
  db.run(sql, [apartadoId], function (err) {
    if (err) {
      return res
        .status(500)
        .json({ error: "Error eliminando apartado: " + err.message });
    }
    if (this.changes === 0) {
      return res.status(404).json({ error: "Apartado no encontrado." });
    }
    res.json({ message: `Apartado #${apartadoId} eliminado exitosamente.` });
  });
});

// == Abonos ==
app.get("/api/abonos", (req, res) => {
  /* ... (no change) ... */
  const { ventaId, apartadoId } = req.query;
  let sql =
    "SELECT id, ventaId, apartadoId, monto, fecha, comentarios FROM abonos";
  let params = [];
  let conditions = [];

  if (ventaId) {
    conditions.push("ventaId = ?");
    params.push(ventaId);
  }
  if (apartadoId) {
    conditions.push("apartadoId = ?");
    params.push(apartadoId);
  }

  if (conditions.length > 0) {
    sql += " WHERE " + conditions.join(" AND ");
  }
  sql += " ORDER BY fecha DESC, id DESC";

  db.all(sql, params, (err, rows) => {
    if (err)
      res
        .status(500)
        .json({ error: "Error fetching payments: " + err.message });
    else res.json(rows);
  });
});
app.post("/api/abonos", (req, res) => {
  /* ... (no change) ... */
  const { ventaId, apartadoId, monto, fecha, comentarios } = req.body;

  if ((!ventaId && !apartadoId) || (ventaId && apartadoId)) {
    return res.status(400).json({
      error:
        "Payment must be linked to either a ventaId OR an apartadoId, but not both or neither.",
    });
  }
  if (monto === undefined || !fecha) {
    return res
      .status(400)
      .json({ error: "Missing required fields for payment (monto, fecha)." });
  }
  const montoAbono = parseFloat(monto);
  if (isNaN(montoAbono) || montoAbono <= 0) {
    return res
      .status(400)
      .json({ error: "Payment amount must be a positive number." });
  }

  let getRefSql, refId, refType;

  if (ventaId) {
    refId = parseInt(ventaId);
    refType = "venta";
    getRefSql = `
            SELECT v.monto as montoTotal, IFNULL(SUM(a.monto), 0) as totalAbonadoActual
            FROM ventas v LEFT JOIN abonos a ON v.id = a.ventaId
            WHERE v.id = ? GROUP BY v.id;`;
  } else {
    refId = parseInt(apartadoId);
    refType = "apartado";
    getRefSql = `
            SELECT ap.montoTotal as montoTotal, IFNULL(SUM(a.monto), 0) as totalAbonadoActual
            FROM apartados ap LEFT JOIN abonos a ON ap.id = a.apartadoId
            WHERE ap.id = ? GROUP BY ap.id;`;
  }

  db.get(getRefSql, [refId], (err, refInfo) => {
    if (err)
      return res
        .status(500)
        .json({ error: `Error fetching ${refType} info: ` + err.message });
    if (!refInfo)
      return res.status(404).json({
        error: `${
          refType.charAt(0).toUpperCase() + refType.slice(1)
        } with ID ${refId} not found.`,
      });

    const saldoPendienteActual =
      refInfo.montoTotal - refInfo.totalAbonadoActual;
    if (montoAbono > saldoPendienteActual + 0.001) {
      return res.status(400).json({
        error: `Payment amount (${montoAbono}) exceeds remaining balance (${saldoPendienteActual.toFixed(
          2
        )}) for ${refType} ${refId}.`,
      });
    }

    const insertSql =
      "INSERT INTO abonos (ventaId, apartadoId, monto, fecha, comentarios) VALUES (?, ?, ?, ?, ?)";
    const params =
      refType === "venta"
        ? [refId, null, montoAbono, fecha, comentarios || null]
        : [null, refId, montoAbono, fecha, comentarios || null];

    db.run(insertSql, params, function (err) {
      if (err)
        return res
          .status(500)
          .json({ error: "Error adding payment: " + err.message });

      const nuevoAbonoId = this.lastID;
      // const nuevoTotalAbonado = refInfo.totalAbonadoActual + montoAbono; // Not used further
      // const nuevoSaldoPendiente = refInfo.montoTotal - nuevoTotalAbonado; // Not used further

      // Update status if fully paid (using a fresh calculation of saldoPendiente after insert for accuracy)
      let checkFullyPaidSql, updateStatusSql;
      if (refType === "venta") {
        checkFullyPaidSql = `SELECT (v.monto - IFNULL(SUM(a.monto),0)) <= 0.001 as esPagada FROM ventas v LEFT JOIN abonos a ON v.id = a.ventaId WHERE v.id = ? GROUP BY v.id`;
        updateStatusSql = "UPDATE ventas SET estado = 'Pagada' WHERE id = ?";
      } else {
        // apartado
        checkFullyPaidSql = `SELECT (ap.montoTotal - IFNULL(SUM(a.monto),0)) <= 0.001 as esPagada FROM apartados ap LEFT JOIN abonos a ON ap.id = a.apartadoId WHERE ap.id = ? GROUP BY ap.id`;
        updateStatusSql =
          "UPDATE apartados SET estadoApartado = 'Pagado' WHERE id = ? AND estadoApartado = 'Apartado'";
      }

      db.get(checkFullyPaidSql, [refId], (paidErr, paidRow) => {
        if (paidErr)
          console.error(
            `Error checking if ${refType} is fully paid:`,
            paidErr.message
          );
        if (paidRow && paidRow.esPagada) {
          db.run(updateStatusSql, [refId], (updateErr) => {
            if (updateErr)
              console.error(
                `Error updating ${refType} status:`,
                updateErr.message
              );
          });
        }
      });
      res.status(201).json({
        id: nuevoAbonoId,
        ventaId: refType === "venta" ? refId : null,
        apartadoId: refType === "apartado" ? refId : null,
        monto: montoAbono,
        fecha,
        comentarios,
      });
    });
  });
});

// --- Start Server ---
app.listen(PORT, () => {
  console.log(`Backend server running at http://localhost:${PORT}`);
  console.log("API Endpoints (v4 - Edición/Eliminación):");
  console.log(`  GET /api/clientes, POST /api/clientes, PUT /api/clientes/:id`);
  console.log(
    `  GET /api/ventas, POST /api/ventas, PUT /api/ventas/:id/fecha, DELETE /api/ventas/:id`
  );
  console.log(
    `  GET /api/apartados, POST /api/apartados, PUT /api/apartados/:id/fecha, DELETE /api/apartados/:id`
  );
  console.log(
    `  PUT /api/apartados/:id/entregar, PUT /api/apartados/:id/cancelar`
  );
  console.log(`  GET /api/abonos?ventaId={id} OR ?apartadoId={id}`);
  console.log(`  POST /api/abonos`);
});

process.on("SIGINT", () => {
  db.close((err) => {
    if (err) console.error(err.message);
    console.log("Closed the database connection.");
    process.exit(0);
  });
});
