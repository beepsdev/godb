const Knex = require('knex');
const Collection = require("../utilities/Collection");
const Sqlbased = require("./Sqlbased");

module.exports = class Mysql extends Sqlbased {

    constructor(opts) {
        super();
        this.createDatabase(opts);
    }

    createDatabase(opts){
        this.connection = new Knex({
            client: opts.client || 'mysql',
            connection: {
                host : opts.host,
                port : opts.port || 3306,
                user : opts.user,
                password : opts.password,
                database : opts.db,
                ssl: opts.ssl || false,
            },
            useNullAsDefault: true,
            postProcessResponse: async (result, queryContext) => {

                if (!queryContext) {
                    return result;
                }

                if (Array.isArray(result)) {
                    let list = new Collection(queryContext);
                    for (const res of result) {
                        const obj = await queryContext.fromResultSet(res, this)
                        list.set(obj.id, obj);
                    }
                    return list;
                } else {
                    return await queryContext.fromResultSet(result, this);
                }
            }
        });

        this.connection.raw('SELECT 1+1').then( data => {
            this.connected = true;
        })

    }

}