"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
var faker_1 = __importDefault(require("faker"));
var channels_1 = __importDefault(require("../channels"));
var db = require('../models');
/////////////////////////////////////////////////////////////////////
/*   THIS FILE CONTAINS THE ALGORITHMS THAT GENERATE DUMMY DATA    */
/*                                                                 */
/* - The functions below are called in channels.ts                 */
/* - This process runs for each table where data is requested      */
/* - generateDummyData creates dummy data values in a table matrix */
/* - This matrix is passed to writeCSV file function, which writes */
/*   a file to the postgres-1 container                            */
/////////////////////////////////////////////////////////////////////
var keyObject;
//helper function to generate random numbers that will ultimately represent a random date
var getRandomInt = function (min, max) {
    min = Math.ceil(min);
    max = Math.floor(max);
    return Math.floor(Math.random() * (max - min) + min); //The maximum is exclusive and the minimum is inclusive
};
// this function generates data for a column
//   column data coming in is an object of the form
//   ex: {
//     'data_type': 'integer';
//     'character_maximum_length': null
//   }
var generateDataByType = function (columnObj) {
    //faker.js method to generate data by type
    switch (columnObj.dataInfo.data_type) {
        case 'smallint':
            return faker_1.default.random.number({ min: -32768, max: 32767 });
        case 'integer':
            return faker_1.default.random.number({ min: -2147483648, max: 2147483647 });
        case 'bigint':
            return faker_1.default.random.number({
                min: -9223372036854775808,
                max: 9223372036854775807,
            });
        case 'character varying':
            if (columnObj.dataInfo.character_maximum_length) {
                return faker_1.default.lorem.character(Math.floor(Math.random() * columnObj.dataInfo.character_maximum_length));
            }
            else
                return faker_1.default.lorem.word();
        case 'date':
            // generating a random date between 1500 and 2020
            var result = '';
            var year = getRandomInt(1500, 2020).toString();
            var month = getRandomInt(1, 13).toString();
            if (month.length === 1)
                month = '0' + month;
            var day = getRandomInt(1, 29).toString();
            if (day.length === 1)
                day = '0' + day;
            result += year + '-' + month + '-' + day;
            return result;
        default:
            console.log('Error generating dummy data by type');
    }
};
// initialize a counter to make sure we are only adding back constraints once we've dropped and re-added columns
var count = 0;
module.exports = {
    writeCSVFile: function (tableObject, schemaLayout, keyObject, dummyDataRequest, event) {
        // extracting variables
        var tableCount = Object.keys(dummyDataRequest.dummyData).length;
        var tableName = tableObject.tableName;
        var tableMatrix = tableObject.data;
        var schemaName = dummyDataRequest.schemaName;
        console.log('tableCount: ', tableCount, 'tableName: ', tableName, 'tableMatrix: ', tableMatrix, 'schemaName: ', schemaName);
        // mapping column headers from getColumnObjects in models.ts to columnNames
        var columnArray = schemaLayout.tables[tableName].map(function (columnObj) { return columnObj.columnName; });
        // transpose the table-matrix to orient it as a table
        var table = [];
        var row = [];
        for (var i = 0; i < tableMatrix[0].length; i++) {
            for (var j = 0; j < tableMatrix.length; j++) {
                row.push(tableMatrix[j][i]);
            }
            //join each subarray (which correspond to rows in our table) with a comma
            var rowString = row.join(',');
            table.push(rowString); //'1, luke, etc'
            row = [];
        }
        // Step 3 - this step adds back the PK constraints that we took off prior to copying the dummy data into the DB (using the db that is imported from models.ts)
        var step3 = function () {
            count += 1;
            var checkLast = tableCount - count;
            if (checkLast === 0) {
                db.addPrimaryKeyConstraints(keyObject, dummyDataRequest)
                    .then(function () {
                    db.addForeignKeyConstraints(keyObject, dummyDataRequest)
                        .then(function () {
                        event.sender.send('async-complete');
                        count = 0;
                    })
                        .catch(function (err) {
                        console.log(err);
                        count = 0;
                    });
                })
                    .catch(function (err) {
                    console.log(err);
                    count = 0;
                });
            }
            else
                return;
        };
        // Step 2 - using the postgres COPY command, this step copies the contents of the csv file in the container file system into the appropriate postgres DB
        var step2 = function () {
            var queryString = "\\copy " + tableName + " FROM '" + tableName + ".csv' WITH CSV HEADER;";
            // run the query in the container using a docker command
            // docker exec postgres-1 psql -U postgres -d ${schemaName} -c "${queryString}"
            channels_1.default("psql -U postgres -d " + schemaName + " -c \"" + queryString + "\" ", step3);
        };
        var csvString;
        //join tableMatrix with a line break (different on mac and windows because of line breaks in the bash CLI)
        if (process.platform === 'win32') {
            var tableDataString = table.join("' >> " + tableName + ".csv; echo '");
            var columnString = columnArray.join(',');
            csvString = columnString
                .concat("' > " + tableName + ".csv; echo '")
                .concat(tableDataString);
            channels_1.default("bash -c \"echo '" + csvString + "' >> " + tableName + ".csv;\"", step2);
        }
        else {
            // we know we are not on Windows, thank god!
            var tableDataString = table.join('\n');
            var columnString = columnArray.join(',');
            csvString = columnString.concat('\n').concat(tableDataString);
            // split csv string into an array of csv strings that each are of length 100,000 characters or less
            // create upperLimit variable, which represents that max amount of character a bash shell command can handle
            var upperLimit = void 0;
            upperLimit = 100000;
            // create stringCount variable that is equal to csvString divided by upper limit rounded up
            var stringCount = Math.ceil(csvString.length / upperLimit);
            // create csvArray that will hold our final csv strings
            var csvArray_1 = [];
            var startIndex = void 0;
            var endIndex = void 0;
            // iterate over i from 0 to less than stringCount, each iteration pushing slices of original csvString into an array
            for (var i = 0; i < stringCount; i += 1) {
                startIndex = upperLimit * i;
                endIndex = startIndex + upperLimit;
                // if on final iteration, only give startIndex to slice operator to grab characters until the end of csvString
                if (i === stringCount - 1)
                    csvArray_1.push(csvString.slice(startIndex));
                else
                    csvArray_1.push(csvString.slice(startIndex, endIndex));
            }
            var index_1 = 0;
            // Step 1 - this writes a csv file to the postgres-1 file system, which contains all of the dummy data that will be copied into its corresponding postgres DB
            var step1_1 = function () {
                // NOTE: in order to rewrite the csv files in the container file system, we must use echo with a single angle bracket on the first element of csvArray AND then move on directly to step2 (and then also reset index)
                // if our csvArray contains only one element
                if (csvArray_1.length === 1) {
                    channels_1.default("bash -c \"echo '" + csvArray_1[index_1] + "' > " + tableName + ".csv;\"", step2);
                    index_1 = 0;
                }
                // otherwise if we are working with the first element in csvArray
                else if (index_1 === 0) {
                    console.log('this is last else statement in step1 on line 211 ');
                    channels_1.default("bash -c \"echo -n '" + csvArray_1[index_1] + "' > " + tableName + ".csv;\"", step1_1);
                    index_1 += 1;
                }
                // if working with last csvArray element, execute docker command but pass in step2 as second argument
                else if (index_1 === csvArray_1.length - 1) {
                    // console.log('FINAL STEP 1: ', csvArray[index]);
                    channels_1.default("bash -c \"echo '" + csvArray_1[index_1] + "' >> " + tableName + ".csv;\"", step2);
                    index_1 = 0;
                }
                // otherwise we know we are not working with the first OR the last element in csvArray, so execute docker command but pass in a recursive call to our step one function and then immediately increment our index variable
                else {
                    // console.log('STEP 1: ', index, csvArray[index]);
                    console.log('this is last else statement in step1 on line 230 ');
                    channels_1.default("bash -c \u201Cecho -n \u2018" + csvArray_1[index_1] + "\u2019 >> " + tableName + ".csv;\u201C", step1_1);
                    index_1 += 1;
                }
            };
            step1_1();
        }
    },
    //maps table names from schemaLayout to sql files
    generateDummyData: function (schemaLayout, dummyDataRequest, keyObject) {
        var returnArray = [];
        //iterate over schemaLayout.tableNames array
        for (var _i = 0, _a = schemaLayout.tableNames; _i < _a.length; _i++) {
            var tableName = _a[_i];
            var tableMatrix = [];
            //if matching key exists in dummyDataRequest.dummyData
            if (dummyDataRequest.dummyData[tableName]) {
                //declare empty columnData array for tableMatrix
                var columnData = [];
                //declare an entry variable to capture the entry we will push to column data
                var entry = void 0;
                //iterate over columnArray (i.e. an array of the column names for the table)
                var columnArray = schemaLayout.tables[tableName].map(function (columnObj) { return columnObj.columnName; });
                for (var i = 0; i < columnArray.length; i++) {
                    // declare a variable j (to be used in while loops below), set equal to zero
                    var j = 0;
                    // if there are either PK or FK columns on this table, enter this logic
                    if (keyObject[tableName]) {
                        // if this is a PK column, add numbers into column 0 to n-1 (ordered)
                        if (keyObject[tableName].primaryKeyColumns[columnArray[i]]) {
                            //while i < reqeusted number of rows
                            while (j < dummyDataRequest.dummyData[tableName]) {
                                //push into columnData
                                columnData.push(j);
                                // increment j
                                j += 1;
                            }
                        }
                        // if this is a FK column, add random number between 0 and n-1 (inclusive) into column (unordered)
                        else if (keyObject[tableName].foreignKeyColumns[columnArray[i]]) {
                            //while j < reqeusted number of rows
                            while (j < dummyDataRequest.dummyData[tableName]) {
                                //generate an entry
                                entry = Math.floor(Math.random() * dummyDataRequest.dummyData[tableName]);
                                //push into columnData
                                columnData.push(entry);
                                j += 1;
                            }
                        }
                        // otherwise, we'll just add data by the type to which the column is constrained
                        else {
                            while (j < dummyDataRequest.dummyData[tableName]) {
                                //generate an entry
                                entry = generateDataByType(schemaLayout.tables[tableName][i]);
                                //push into columnData
                                columnData.push(entry);
                                j += 1;
                            }
                        }
                    }
                    // otherwise, we'll just add data by the type to which the column is constrained
                    else {
                        while (j < dummyDataRequest.dummyData[tableName]) {
                            //generate an entry
                            entry = generateDataByType(schemaLayout.tables[tableName][i]);
                            //push into columnData
                            columnData.push(entry);
                            j += 1;
                        }
                    }
                    //push columnData array into tableMatrix
                    tableMatrix.push(columnData);
                    //reset columnData array for next column
                    columnData = [];
                }
                // only push something to the array if data was asked for for the specific table
                returnArray.push({ tableName: tableName, data: tableMatrix });
            }
        }
        // then return the returnArray
        return returnArray;
    },
};
//# sourceMappingURL=dummyDataMain.js.map