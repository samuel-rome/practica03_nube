require('dotenv').config();
const express = require('express');
const mysql = require('mysql2');
const ejs = require('ejs');
const { S3Client, PutObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const multer = require('multer');

const app = express();
const port = process.env.PORT || 3000;

// Configuración de conexión a la base de datos MySQL en PlanetScale
const connection = mysql.createConnection(process.env.DATABASE_URL);

connection.connect((err) => {
  if (err) {
    console.error('Error al conectar a la base de datos: ', err);
    return;
  }
  console.log('Conexión a la base de datos establecida.');
});

// Configuración de AWS S3
const s3Client = new S3Client({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

// Configuración de Multer para manejar el almacenamiento de archivos
const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

// Establecer el motor de plantillas EJS
app.set('view engine', 'ejs');
app.use(express.urlencoded({ extended: true }));

// Rutas
app.get('/', (req, res) => {
  connection.query('SELECT * FROM paciente', (err, results) => {
    if (err) {
      console.error('Error al obtener los pacientes: ', err);
      return;
    }
    res.render('index', { pacientes: results });
  });
});

app.get('/pacientes/nuevo', (req, res) => {
  res.render('nuevo');
});

app.post('/pacientes', upload.single('foto'), async (req, res) => {
  const { apellidos, nombres, sexo, especialidad } = req.body;
  const foto = req.file;

  // Crear una instancia del comando PutObject para subir la foto a S3
  const uploadParams = {
    Bucket: process.env.AWS_S3_BUCKET_NAME,
    Key: `ruta/del/objeto/${Date.now()}_${foto.originalname}`,
    Body: foto.buffer,
  };

  try {
    // Ejecutar el comando PutObject para subir la foto a S3
    await s3Client.send(new PutObjectCommand(uploadParams));

    const paciente = {
      apellidos,
      nombres,
      sexo,
      especialidad,
      foto: `https://s3.amazonaws.com/${process.env.AWS_S3_BUCKET_NAME}/${uploadParams.Key}`,
    };

    // Insertar el paciente en la base de datos
    connection.query('INSERT INTO paciente SET ?', paciente, (err) => {
      if (err) {
        console.error('Error al agregar el paciente: ', err);
        return;
      }
      res.redirect('/');
    });
  } catch (err) {
    console.error('Error al subir la foto a S3: ', err);
    return;
  }
});

app.get('/pacientes/:id/editar', (req, res) => {
  const id = req.params.id;

  connection.query('SELECT * FROM paciente WHERE idpaciente = ?', id, (err, results) => {
    if (err) {
      console.error('Error al obtener el paciente: ', err);
      return;
    }

    res.render('editar', { paciente: results[0] });
  });
});

app.post('/pacientes/:id/editar', upload.single('foto'), async (req, res) => {
  const id = req.params.id;
  const { apellidos, nombres, sexo, especialidad } = req.body;
  const foto = req.file;

  // Si se seleccionó una nueva foto, subirla a S3 y actualizar la URL de la foto en la base de datos
  if (foto) {
    const uploadParams = {
      Bucket: process.env.AWS_S3_BUCKET_NAME,
      Key: `ruta/del/objeto/${Date.now()}_${foto.originalname}`,
      Body: foto.buffer,
    };

    try {
      await s3Client.send(new PutObjectCommand(uploadParams));

      const paciente = {
        apellidos,
        nombres,
        sexo,
        especialidad,
        foto: `https://s3.amazonaws.com/${process.env.AWS_S3_BUCKET_NAME}/${uploadParams.Key}`,
      };

      // Eliminar la imagen anterior del paciente de S3
      const oldPaciente = await new Promise((resolve, reject) => {
        connection.query('SELECT foto FROM paciente WHERE idpaciente = ?', id, (err, results) => {
          if (err) {
            reject(err);
            return;
          }
          resolve(results[0]);
        });
      });

      if (oldPaciente && oldPaciente.foto) {
        const oldFotoKey = oldPaciente.foto.split('/').pop();
        const deleteParams = {
          Bucket: process.env.AWS_S3_BUCKET_NAME,
          Key: `ruta/del/objeto/${oldFotoKey}`,
        };
        await s3Client.send(new DeleteObjectCommand(deleteParams));
      }

      // Actualizar el paciente en la base de datos
      connection.query('UPDATE paciente SET ? WHERE idpaciente = ?', [paciente, id], (err) => {
        if (err) {
          console.error('Error al actualizar el paciente: ', err);
          return;
        }

        res.redirect('/');
      });
    } catch (err) {
      console.error('Error al subir la foto a S3: ', err);
      return;
    }
  } else {
    // Si no se seleccionó una nueva foto, actualizar los demás campos en la base de datos
    const paciente = {
      apellidos,
      nombres,
      sexo,
      especialidad,
    };

    connection.query('UPDATE paciente SET ? WHERE idpaciente = ?', [paciente, id], (err) => {
      if (err) {
        console.error('Error al actualizar el paciente: ', err);
        return;
      }

      res.redirect('/');
    });
  }
});

app.post('/pacientes/:id/eliminar', async (req, res) => {
  const id = req.params.id;

  // Obtener la imagen del paciente a eliminar
  const paciente = await new Promise((resolve, reject) => {
    connection.query('SELECT foto FROM paciente WHERE idpaciente = ?', id, (err, results) => {
      if (err) {
        reject(err);
        return;
      }
      resolve(results[0]);
    });
  });

  // Eliminar la imagen del bucket de S3
  if (paciente && paciente.foto) {
    const fotoKey = paciente.foto.split('/').pop();
    const deleteParams = {
      Bucket: process.env.AWS_S3_BUCKET_NAME,
      Key: `ruta/del/objeto/${fotoKey}`,
    };
    try {
      await s3Client.send(new DeleteObjectCommand(deleteParams));
    } catch (err) {
      console.error('Error al eliminar la imagen del paciente de S3: ', err);
      return;
    }
  }

  // Eliminar el paciente de la base de datos
  connection.query('DELETE FROM paciente WHERE idpaciente = ?', id, (err) => {
    if (err) {
      console.error('Error al eliminar el paciente: ', err);
      return;
    }
    res.redirect('/');
  });
});

// Iniciar el servidor
app.listen(port, () => {
  console.log(`Servidor iniciado en http://localhost:${port}`);
});
