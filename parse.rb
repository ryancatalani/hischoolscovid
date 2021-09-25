require "dotenv/load"
require "roo"
require "date"
require "smarter_csv"
require "aws-sdk-s3"
require "json"
require "csv"

parsed_cases = []
schools = []

# CSV helper

def to_csv_str(arr)
	# Array of hashes
	csv_str = CSV.generate do |csv|
		csv << arr.first.keys
		arr.each do |row|
			csv << row.values
		end
	end
	return csv_str.chomp
end

# Load case spreadsheet

xlsx = Roo::Spreadsheet.open(ARGV[0])
sheet = xlsx.sheet(0)

# Clean up cases

first_row = 1
last_row = sheet.last_row

(first_row..last_row).each do |row_index|

	complex_area = sheet.cell(row_index, 1)
	if complex_area.nil?
		# Move back 2: 
		# - 1 because row_index starts at 1, not 0
		# - 1 to move back to previous array item
		complex_area = parsed_cases[row_index-2][:complex_area]
	end

	school = sheet.cell(row_index, 2)
	if school.nil?
		school = parsed_cases[row_index-2][:school]
	end

	date_reported_str = sheet.cell(row_index, 3)
	date_reported = nil
	if date_reported_str.nil?
		date_reported_str = parsed_cases[row_index-2][:date_reported_str]
		date_reported = parsed_cases[row_index-2][:date_reported]
	else
		date_reported = Date.parse(date_reported_str)
	end

	last_date_on_campus = sheet.cell(row_index, 4)
	if last_date_on_campus.nil?
		last_date_on_campus = "Unspecified"
	end

	island = sheet.cell(row_index, 5)
	count = sheet.cell(row_index, 6)
	source = "https://public.tableau.com/app/profile/hidoe.dga/viz/COVID-19HIDOECaseCountPublicDashboard/List"

	if (island =~ /\n/ && count =~ /\n/)
		# PDF parsed incorrectly and row needs to be manually split
		split_islands = island.split("\n")
		split_count = count.split("\n")

		if split_islands.count != split_count.count
			puts "⚠️  Alert: Mismatch in split: row #{row_index}"
		end

		split_islands.count.times do |split_index|
			the_case = {
				complex_area: complex_area,
				school: school,
				date_reported_str: date_reported_str,
				date_reported: date_reported,
				last_date_on_campus: last_date_on_campus,
				# island: split_islands[split_index],
				count: split_count[split_index].to_i,
				source: source
			}
			parsed_cases << the_case
		end
	else
		# Normal, expected circumstance
		the_case = {
			complex_area: complex_area,
			school: school,
			date_reported_str: date_reported_str,
			date_reported: date_reported,
			last_date_on_campus: last_date_on_campus,
			# island: island,
			count: count.to_i,
			source: source
		}
		parsed_cases << the_case
	end

end

# pp parsed_cases

grand_total = parsed_cases.sum{|c| c[:count] }
puts "Grand total: #{grand_total}"

# Create school totals

all_school_data = SmarterCSV.process('schoolslist.csv')

school_names = parsed_cases.map{|c| c[:school]} + all_school_data.map{|s| s[:sch_name]}
school_names.uniq!.sort!

school_names.each do |school_name|

	school_cases = parsed_cases.filter{|c| c[:school] == school_name}
	
	cumulative_recent = school_cases.filter{|c| Date.today - c[:date_reported] <= 14}.sum{|c| c[:count]}
	prev_two_weeks = school_cases.filter{ |c| 
		(Date.today - c[:date_reported] > 14) && (Date.today - c[:date_reported] <= 28)
	}.sum{|c| c[:count]}
	two_week_change = "N/A"

	if (prev_two_weeks > 0) 
		two_week_change = (cumulative_recent.to_f - prev_two_weeks.to_f) / (prev_two_weeks.to_f)
	end

	the_school = {
		name: school_name,
		cumulative_recent: cumulative_recent,
		cumulative: school_cases.sum{|c| c[:count]},
		prev_two_weeks: prev_two_weeks,
		two_week_change: two_week_change
	}

	school_data = all_school_data.find{|s| s[:sch_name] == school_name }
	if school_data.nil?
		puts "⚠️  Alert: No data found for #{school_name}"
	else
		# School data found
		the_school.merge!({
			lat: school_data[:y],
			long: school_data[:x],
			id: school_data[:sch_code],
			enrollment: school_data[:enrollment],	
			teachers: school_data[:teachers],
			admin_fte: school_data[:adminfte]
		})
	end

	schools << the_school

end

# pp schools

meta = {
	last_updated: Time.now.strftime("%B %d, %Y"),
	grand_total: grand_total
}

s3 = Aws::S3::Resource.new(region: ENV['S3_REGION'])
s3.bucket(ENV['S3_BUCKET']).object("doe_cases/meta.json").put(body: meta.to_json, acl: "public-read")
s3.bucket(ENV['S3_BUCKET']).object("doe_cases/cases.csv").put(body: to_csv_str(parsed_cases), acl: "public-read")
s3.bucket(ENV['S3_BUCKET']).object("doe_cases/schools.csv").put(body: to_csv_str(schools), acl: "public-read")
puts "Saved to S3."