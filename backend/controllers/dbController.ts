const fetch = require('node-fetch');
const cookieParser = require('cookie-parser');
const { Pool } = require('pg');
const users = {};
let dbnum = 0;

const dbController = {
  makeDB: async (req, res, next) => {
    if (!('session_id' in req.cookies)) {
      const options = {
        method: 'POST',
        headers: {
          Authorization:
            'Basic Ojg4MDVmN2U2LTBiZWUtNDcwNC04OWRlLTU5YmM2ZTJlNWEyYw==',
        },
      };
      const response = await fetch(
        `https://customer.elephantsql.com/api/instances?name=db${++dbnum}9&plan=turtle&region=amazon-web-services::us-east-1`,
        options
      );
      const data = await response.json();
      const { id, url } = data;
      const expiry = 1200000;
      users[id] = new Pool({ connectionString: url });
      res.cookie('session_id', id, { maxAge: expiry });

      setTimeout(() => dbController.deleteDB(id), expiry); //20 minutes
    } else {
      const options = {
        method: 'GET',
        headers: {
          Authorization:
            'Basic Ojg4MDVmN2U2LTBiZWUtNDcwNC04OWRlLTU5YmM2ZTJlNWEyYw==',
        },
      };
      const response = await fetch(
        `https://customer.elephantsql.com/api/instances/${req.cookies.session_id}`,
        options
      );
      const data = await response.json();
      const { url } = data;
      users[req.cookies.session_id] = new Pool({ connectionString: url });
    }
    next();
  },

  deleteDB: async (id) => {
    const options = {
      method: 'DELETE',
      headers: {
        Authorization:
          'Basic Ojg4MDVmN2U2LTBiZWUtNDcwNC04OWRlLTU5YmM2ZTJlNWEyYw==',
      },
    };
    const response = await fetch(
      `https://customer.elephantsql.com/api/instances/${id}`,
      options
    );
  },
};

export default dbController;
