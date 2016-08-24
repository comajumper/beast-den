// Подключаем необходимые модули
var express = require('express');
var bodyParser = require('body-parser');
var handlebars = require('express-handlebars');

// Настраиваем роутинг
var routes = require('./routes/');

// Инициализируем приложение
var app = express();

// Конфигурация сервера
var server = { port: 3333, url: 'localhost' }

// Включаем bodyParser для тела запроса
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

// Устанавливаем путь до локальных файлов
app.use(express.static('app'));

// Подключаем Handelbars шаблонизатор
app.set('views', 'app/pages/');
app.engine('hbs', handlebars({defaultLayout: 'main', extname: '.hbs', layoutsDir: 'app/pages/templates/'}));
app.set('view engine', 'hbs');

// Влючаем роутинг
app.use('/', routes);

// Запускаем сервер
app.listen(server.port, function () {
    console.log("\n");
    console.log("Server is running at http://" + server.url + ":" + server.port + "/");
});
