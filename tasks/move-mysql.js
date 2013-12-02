var exec = require('child_process').exec;

var tpl = {
	backup_path: '<%= base_dir %>/<%= db_folder %>/<%= date %>/<%= time %>',
	mysqldump: 'mysqldump -h <%= host %> -u <%= user %> -p<%= pass %> <%= database %>',
	mysql: 'mysql -h <%= host %> -u <%= user %> -p<%= pass %> <%= database %>',
	search_replace: "sed -i '' 's#<%= search %>#<%= replace %>#g' <%= file %>"
};

module.exports = function(grunt) {
	
	grunt.registerTask('move-mysql', 'Move mysql database', function() {
		
		grunt.log.writeln('');
		
		var done = this.async();
		
		var options = grunt.config.get('mysqldbs').options || {};
		options.backup_folder = options.backup_folder || 'db-backups';
		
		// Read command flags
		var origin = grunt.option('from');
		var target = grunt.option('to');
		var to_backup = grunt.option('backup');
		var note = grunt.option('note') || false;
		
		
		if ( typeof grunt.config.get('mysqldbs') === 'undefined' ) {
			grunt.fail.warn('Ensure a correct setup for grunt.initConfig(), passing a mysqldbs {}');
		}
		
		if (typeof to_backup !== 'undefined') {
			if (typeof grunt.config.get('mysqldbs')[to_backup] === 'undefined') {
				grunt.fail.warn('You passed an invalid "--backup" argument');
				done(false);
				return;
			}
			
			// Just backup the selected database
			to_backup = get_db_data(to_backup);
			
			// Generate backup path
			var backup_path = generate_backup_path(to_backup, options.backup_folder);
			
			// Dump target db and backup it
			dump_db(to_backup, backup_path, false, function(err, file) {
				
				if (err) {
					grunt.log.error(err);
					return done(false);
				}
				
				if (note) {
					var note_file = backup_path + '/note.txt';
					write_note(note, note_file, function(err) {
						
						if (err) {
							grunt.log.error(err);
							return done(false);
						}
						
						done();
						
					});
					
				} else {
					
					done();
					
				}
				
			});
			
			return;
		} 
		
		if ( typeof origin === 'undefined' || typeof grunt.config.get('mysqldbs')[origin] === 'undefined' ) {
			grunt.fail.warn('You passed an invalid or empty "--from" argument');
		}
		if ( typeof target === 'undefined' || typeof grunt.config.get('mysqldbs')[target] === 'undefined' ) {
			grunt.fail.warn('You passed an invalid or empty "--to" argument');
		}
		
		origin = get_db_data(origin);
		
		target = get_db_data(target);
		
		// Dump origin db in a temp file
		dump_db(origin, options.backup_folder, true, function(err, temp_file) {
			
			if (err) {
				grunt.log.error(err);
				return done(false);
			}
			
			// Replace origin.url with target.url
			replace_string(origin.url, target.url, temp_file, function(err) {
				
				if (err) {
					grunt.log.error(err);
					return done(false);
				}
				
				// Generate backup path
				var backup_path = generate_backup_path(target, options.backup_folder);
				
				// Dump target db and backup it
				dump_db(target, backup_path, false, function(err, file) {
					
					if (err) {
						grunt.log.error(err);
						return done(false);
					}
					
					// Import temp file into target
					import_db(temp_file, target, function(err) {
						
						if (err) {
							grunt.log.error(err);
							return done(false);
						}
						
						exec('rm '+ temp_file, function() {
							done();
						});
						
					});
					
				});
				
			});
			
		});
		
	});
	
	function get_db_data(db) {
		var data = grunt.config.get('mysqldbs')[db];
		data.name = data.name.replace(' ', '-');
		
		return data;
	};
	
	function dump_db(db, folder, temp, cb) {
		
		grunt.file.mkdir(folder);
		
		var cmd;
		
		var mysqldump = grunt.template.process(tpl.mysqldump, {data: db});
		var file = folder +'/['+ db.name +']'+ db.database;
		file += temp ? '-tmp.sql' : '.sql';
		
		if (db.ssh) {
			var ssh = 'ssh '+ db.ssh.user;
			ssh += db.ssh.pass ? ':'+ db.ssh.pass : '';
			ssh += '@'+ db.ssh.host;
			
			cmd = ssh + " '"+ mysqldump +"' > " + file;
		} else {
			cmd = mysqldump +' > '+ file;
		}
		
		grunt.log.verbose.writeln('Dumping database "' + db.name + '": '+ cmd);
		
		exec(cmd, function(err, stdout, stderr) {
			if (err) {
				return cb(err, null);
			}
			
			grunt.log.ok('Database "'+ db.name +'" dumped into: '+ file);
			grunt.log.writeln('');
			return cb(null, file);
		});
		
	};
	
	function import_db(file, target, cb) {
		
		var cmd;
		
		var mysqlcmd = grunt.template.process(tpl.mysql, {data: target});
		
		if (target.ssh) {
			var ssh = 'ssh '+ target.ssh.user;
			ssh += target.ssh.pass ? ':'+ target.ssh.pass : '';
			ssh += '@'+ target.ssh.host;
			
			cmd = ssh + " '"+ mysqlcmd +"' < " + file;
		} else {
			cmd = mysqlcmd +' < '+ file;
		}
		
		grunt.log.verbose.writeln('Importing database "' + file + '" into "' + target.name + '" location: '+ cmd);
		
		exec(cmd, function(err, stdout, stderr) {
			if (err) {
				return cb(err);
			}
			
			grunt.log.ok('"'+ file +'" imported into "'+ target.name +'" location');
			grunt.log.writeln('');
			return cb(null);
		});
		
	};
	
	function replace_string(search, replace, target_file, cb) {
		
		var cmd = grunt.template.process(tpl.search_replace, {
			data: {
				search: search,
				replace: replace,
				file: target_file
			}
		});
		
		grunt.log.verbose.writeln('Replacing strings: '+ cmd);
		
		exec(cmd, function(err, stdout, stderr) {
			if (err) {
				return cb(err, null);
			}
			
			grunt.log.ok('String "'+ search +'" replaced with "'+ replace +'"');
			grunt.log.writeln('');
			return cb(null, true)
		});
		
	};
	
	function generate_backup_path(db, base_dir) {
		
		return grunt.template.process(tpl.backup_path, {
			data: {
				base_dir: base_dir,
        date: grunt.template.today('yyyymmdd'),
        time: grunt.template.today('HH-MM-ss'),
				db_folder: db.name
			}
		});
		
	};
	
	function write_note(note, file, cb) {
		var cmd = "echo '"+ note +"' > "+ file;
		
		grunt.log.verbose.writeln('Writing note: '+ cmd);
		
		exec(cmd, function(err, stdout, stderr) {
			if (err) {
				return cb(err);
			}
			
			grunt.log.ok('Note written into: '+ file);
			grunt.log.writeln('');
			
			return cb(null);			
		});
	};
	
};