'use strict';

var gulp = require('gulp');
var prefix = require('gulp-autoprefixer');
var stylus = require('gulp-stylus');
var concat = require('gulp-concat');
var watch = require('gulp-watch');

var path = {
    bml:    'app/blocks/**/*.bml.js',
    styl:   'app/blocks/**/*.styl',
    build:  'app/build'
};

gulp.task('blocks', function() {
    return gulp
            .src(path.bml)
            .pipe(concat('blocks.bml.js'))
            .pipe(gulp.dest(path.build));
});

gulp.task('styles', function () {
    return gulp
            .src(path.styl)
            .pipe(concat('main.styl'))
            .pipe(stylus({compress: true}))
            .pipe(concat('main.css'))
            .pipe(gulp.dest(path.build));
});

gulp.task('prefix', function () {
    return gulp
        .src(path.build + '/*.css')
        .pipe(prefix(["last 8 version", "> 1%", "ie 8"]))
        .pipe(gulp.dest(path.build));
});

gulp.task('watch', function () {
    gulp.watch(path.bml, ['blocks']);
    gulp.watch(path.styl, ['styles','prefix']);
});

gulp.task('default', ['blocks','styles','prefix','watch'])
