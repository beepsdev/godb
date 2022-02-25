const Knex = require('knex');
const Path = require('path');
const Connector = require('./base');
const Storable = require("../utilities/storable");
const {InvalidArgumentError} = require("../utilities/errors");
const {nanoid} = require("nanoid");
const Collection = require("../utilities/collection");

module.exports = class Sqlbased extends Connector {

    connection;

    // Types used by the database
    types = {
        id: 'VARCHAR(255)',
        string: 'VARCHAR(255)',
        text: 'TEXT',
        int: 'INTEGER',
        boolean: 'BOOLEAN',
        date: 'DATETIME'
    }

    // TODO: Add proper data validators, these are placeholders
    validators = {
        string: async function(input){
            return String(input);
        },
        text: async function(input){
            return String(input);
        },
        id: async function(input){
            return String(input);
        },
        int: async function(input){
            return Number(input).toFixed(0);
        },
        boolean: async function(input){
            return !!input;
        },
        datetime: async function(input){
            if(input instanceof Date){
                return input;
            }else{
                return new Date(input);
            }
        },
    }

    constructor(){
        super();
    }

    createDatabase(){
        this.connection = new Knex();
    }

    async #test(){
        return await this.connection.raw('SELECT 1+1')['1+1'] === 2;
    }
    /**
     * @param Model ../storable.js
     * @returns {Promise<void>}
     */
    initStore(Model){

        let me = this;
        this.connection.schema.hasTable(Model.table).then(function(success){
            if(!success){
                me.#createTableSchema(Model);
            }else{
                me.#updateTableSchema(Model);
            }
        })

    }
    /**
     *
     * @param Model ../storable.js
     */
    async #createTableSchema(Model){
        let me = this;
        return this.connection.schema.createTable(`${Model.table}`, async function (table) {
            table = me.buildTable(Model, table, [], false);
            return table;
        });
    }
    /**
     *
     * @param Model ../storable.js
     */
    async #updateTableSchema(Model){
        let me = this;
        let createdColumns = await this.getCreatedColumns(Model);

        return this.connection.schema.table(`${Model.table}`, async function (table) {
            table = me.buildTable(Model, table, createdColumns, true);
            return table;
        })
    }
    async getCreatedColumns(Model){

        const columns = Model.defineColumns(this);

        let cc = [];
        for(let b = 0; b < columns.length;b++){
            const column = columns[b]
            let exists = await this.connection.schema.hasColumn(Model.table, column.name);
            if(exists){
                cc.push(column.name);
            }
        }

        return cc;

    }
    async buildTable(Model, tableBuilder, cc, isUpdate){

        const columns = Model.defineColumns(this);

        for(let b = 0; b < columns.length;b++){

            const column = columns[b]

            // create base column type with limit if possible.
            let col = tableBuilder.specificType(column.name, column.type);

            column.nullable ? col.nullable() : col.notNullable();

            if(column.primary === true){
                col.primary(`primary_${column.name}`);
            }

            if(column.index){
                col.index(`x${column.index}`);
            }

            if(column.references  && column.references.prototype instanceof Storable){

                let ref_field = column.reference_field;
                if(!column.reference_field){
                    ref_field = 'id';
                }

                col.references(`${column.references.table}.${ref_field}`);
            }

            // if exists alter
            if(cc.includes(column.name)){
                col.alter();
            }

        }

        return tableBuilder;
    }

    async getByID(Model, Id, deleted = false){
        return this.connection.table(Model.table).where({
            id: Id,
            deleted: deleted ? 1 : 0
        }).queryContext(Model);
    }

    async getByField(Model, field, value, deleted = false){

        let where = {
            deleted: deleted ? 1 : 0
        };
        where[field] = value;
        return this.connection.table(Model.table).where(where).queryContext(Model);
    }

    async loadBy(Model, Where, deleted = false){

        let q = this.connection.table(Model.table).queryContext(Model);
        if(!deleted){
            q = q.andWhere('deleted', 0);
        }
        Where.forEach( w => {
            q = q.andWhere(w.field, w.operator, w.value);
        })

        return q;

    }

    /**
     *
     * @param Model Storable
     * @param filter {{field: String, operation: String, value: *}}
     * @param limit Number
     * @param countField String
     * @returns {AsyncGenerator<*, void, *>}
     */
    async *search(Model, filter, limit, countField = 'updatedon'){

        let resultCount = Number(limit);
        let offset = 0;

        let queryResult;
       while(resultCount >= limit){

           queryResult = await this.connection.table(Model.table).where(filter).andWhere('updatedon', '>', offset).limit(limit).queryContext(Model);
           resultCount = queryResult.length;
           if(resultCount > 0){
               offset = queryResult[resultCount-1].updatedon;
           }

           if(resultCount >= limit){
               yield {result: queryResult, currentOffset: offset, count: resultCount};
           }else{
               return {result: queryResult, currentOffset: offset, count: resultCount};
           }

       }

    }

    /**
     * @param object Storable
     * @returns Promise
     */
    async save(object){

        if(!(object instanceof Storable)){
            throw new InvalidArgumentError(object, Storable);
        }

        if(!object.changed){
            return false;
        }

        let newValues = {}
        const fields = object.constructor.defineColumns(this);

        // update internally managed fields
        object.updatedon = new Date();
        if(object.createdon === null){
            object.createdon = new Date();
        }

        // add all fields via their getters
        fields.forEach((field)=> {
            newValues[field.name] = object[field.field];
        })


        if(object.id !== null){

            // update records
            await this.connection.table(object.constructor.table)
                .where({ id: object.id })
                .update(newValues).queryContext(object.constructor);

            return true;


        }else{

            // create ID
            newValues['id'] = object.constructor.generateID();
            object.id = newValues['id'];

            // create record
            await this.connection.table(object.constructor.table)
                .insert(newValues).queryContext(object.constructor);

            return true;

        }

    }

}